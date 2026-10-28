/**
 * Electron 主进程入口(多 workspace 版)。
 * pi 进程不随窗口启动自动拉起——渲染进程确定 activeCwd 后,
 * 第一条命令经 RpcClientPool 懒启动对应进程。
 *
 * 安全边界(渲染进程被视为"可能被模型输出/外链污染"的不受信环境):
 * - sandbox + contextIsolation:preload 只暴露显式白名单 API
 * - 页面内导航/新窗口一律拦截,http(s) 外链交给系统浏览器
 * - CSP 由响应头(开发)与构建时注入的 meta(生产)双重约束
 *
 * 桌面体验:
 * - 中文应用菜单 + 快捷键(动作经 app:command 下发,状态仍在渲染端)
 * - 右键菜单(复制/粘贴/全选/复制链接)——Electron 默认不提供
 * - 窗口几何记忆、主题色启动背景、首次安装运行时的启动提示
 */
import { app, BrowserWindow, clipboard, Menu, nativeTheme, session, type WebContents } from "electron";
import { join } from "node:path";
import { RpcClientPool } from "./rpc/pool";
import { registerIpcHandlers } from "./ipc";
import { DEV_CSP, PROD_CSP } from "../shared/csp";
import { openExternalSafely } from "./util/external";
import { ensureBundledRuntime, needsRuntimeInstall } from "./runtime";
import { buildAppMenu } from "./menu";
import { loadWindowState, trackWindowState } from "./window-state";
import type { AppCommand } from "../shared/ipc";
import { IpcChannels } from "../shared/ipc";

const isDev = !!process.env.ELECTRON_RENDERER_URL;

const pool = new RpcClientPool();
let mainWindow: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;

/** 深浅色下的启动背景(与 globals.css 的 --ground 一致),避免深色主题启动时白闪 */
function startupBackground(): string {
	return nativeTheme.shouldUseDarkColors ? "#1b1b1d" : "#f6f6f4";
}

/** 同地址(仅 hash 不同)不算外链跳转:放行 vite 的整页刷新 */
function isSameDocument(current: string, next: string): boolean {
	if (!current) return false;
	const strip = (u: string): string => u.split("#")[0] ?? u;
	return strip(current) === strip(next);
}

/** 页面右键菜单:编辑区给剪切/复制/粘贴,选中文本给复制,链接给打开/复制地址 */
function attachContextMenu(contents: WebContents): void {
	contents.on("context-menu", (_event, params) => {
		const items: Electron.MenuItemConstructorOptions[] = [];
		if (params.isEditable) {
			items.push(
				{ label: "撤销", role: "undo", enabled: params.editFlags.canUndo },
				{ label: "重做", role: "redo", enabled: params.editFlags.canRedo },
				{ type: "separator" },
				{ label: "剪切", role: "cut", enabled: params.editFlags.canCut },
				{ label: "复制", role: "copy", enabled: params.editFlags.canCopy },
				{ label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
				{ type: "separator" },
				{ label: "全选", role: "selectAll" },
			);
		} else if (params.selectionText.trim()) {
			items.push({ label: "复制", role: "copy" }, { type: "separator" }, { label: "全选", role: "selectAll" });
		}
		if (params.linkURL) {
			if (items.length > 0) items.push({ type: "separator" });
			items.push(
				{ label: "在浏览器中打开链接", click: () => openExternalSafely(params.linkURL) },
				{ label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) },
			);
		}
		if (items.length > 0) Menu.buildFromTemplate(items).popup();
	});
}

/** 页面级导航防护(对每个 webContents 生效) */
function hardenContents(contents: WebContents): void {
	contents.on("will-navigate", (event, url) => {
		if (isSameDocument(contents.getURL(), url)) return;
		event.preventDefault();
		openExternalSafely(url);
	});
	contents.setWindowOpenHandler(({ url }) => {
		openExternalSafely(url);
		return { action: "deny" };
	});
	contents.on("will-attach-webview", (event) => event.preventDefault());
	attachContextMenu(contents);
}

function applyCsp(): void {
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [isDev ? DEV_CSP : PROD_CSP],
			},
		});
	});
}

/** 首次安装内置运行时的提示窗(打包版 + 需要解包时才有) */
function createSplash(): void {
	const bg = startupBackground();
	const fg = nativeTheme.shouldUseDarkColors ? "#e6e6e6" : "#1b1b1d";
	const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:${bg};color:${fg};font-family:"Segoe UI","Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center;-webkit-user-select:none;cursor:default}
.wrap{display:flex;align-items:center;gap:14px}
.logo{font-size:30px;font-weight:700;color:#1783ff;line-height:1}
.t{font-size:13px;opacity:.72}
.bar{margin-top:9px;height:3px;width:210px;border-radius:2px;background:rgba(128,128,128,.25);overflow:hidden}
.bar i{display:block;height:100%;width:40%;border-radius:2px;background:#1783ff;animation:slide 1.2s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
</style></head><body><div class="wrap"><span class="logo">pi</span><div><div class="t">正在准备运行时(首次启动,约 3 秒)…</div><div class="bar"><i></i></div></div></div></body></html>`;

	splash = new BrowserWindow({
		width: 420,
		height: 128,
		frame: false,
		resizable: false,
		movable: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		backgroundColor: bg,
		webPreferences: { sandbox: true },
	});
	splash.center();
	void splash.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
	splash.on("closed", () => {
		splash = null;
	});
}

function createWindow(): void {
	const state = loadWindowState();
	mainWindow = new BrowserWindow({
		width: state.width,
		height: state.height,
		...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
		minWidth: 960,
		minHeight: 600,
		// 启动背景跟随主题,避免深色模式下先闪一块白
		backgroundColor: startupBackground(),
		autoHideMenuBar: true,
		show: false,
		// dev 下用项目图标(打包后由 exe 图标决定)
		...(isDev ? { icon: join(app.getAppPath(), "build", "icon.png") } : {}),
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			// 渲染进程不需要 Node 能力:preload 只用 contextBridge/ipcRenderer/webFrame
			sandbox: true,
		},
	});

	if (state.maximized) mainWindow.maximize();
	trackWindowState(mainWindow);

	// 内容准备好再显示:避免"白窗口闪一下"
	mainWindow.once("ready-to-show", () => {
		mainWindow?.show();
		if (splash) {
			splash.destroy();
			splash = null;
		}
	});

	hardenContents(mainWindow.webContents);

	// electron-vite 约定:dev 走 dev server URL,生产加载打包产物
	if (process.env.ELECTRON_RENDERER_URL) {
		void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	}

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

/** 菜单/快捷键 → 渲染进程 */
function sendCommand(cmd: AppCommand): void {
	const contents = mainWindow?.webContents;
	if (!contents || contents.isDestroyed()) return;
	contents.send(IpcChannels.appCommand, cmd);
}

// 单实例:两个实例会各自 spawn pi、各自写 auth.json,必须互斥
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	});

	app.whenReady().then(async () => {
		applyCsp();
		// 首次启动把内置 pi 载荷搬到用户目录(~/.pi-desktop/runtime/pi/<version>)。
		// 失败不阻塞:配置解析会退回「缺失」,由设置面板给出可操作提示。
		if (needsRuntimeInstall()) createSplash();
		await ensureBundledRuntime().catch((err) =>
			console.error("[runtime] 内置 pi 安装失败:", err),
		);
		// 安装完成后重新解析配置,让 cliPath 指向用户目录里的运行时
		pool.reloadConfig();
		registerIpcHandlers(() => mainWindow, pool);
		buildAppMenu(sendCommand);
		createWindow();

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on("before-quit", () => {
		// 无论哪个平台退出,都要确保 pi 子进程不残留
		pool.disposeAll();
	});

	app.on("window-all-closed", () => {
		pool.disposeAll();
		// macOS 习惯:关窗不退出应用(点 Dock 图标可重新开窗)
		if (process.platform !== "darwin") app.quit();
	});
}
