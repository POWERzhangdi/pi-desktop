/**
 * IPC 处理器:把渲染进程的调用桥到 RpcClientPool / 会话扫描器 / workspace 注册表,
 * 并把 pool 的事件/状态(带 cwd 信封)转发给窗口。
 */
import { app, ipcMain, dialog, nativeTheme, type BrowserWindow } from "electron";
import {
	IpcChannels,
	type CustomProvider,
	type McpServerConfig,
	type PiConfig,
	type ProviderTestRequest,
} from "../shared/ipc";
import type { RpcClientPool } from "./rpc/pool";
import { writeConfigFile } from "./rpc/client";
import { unlink, rename } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { scanSessions } from "./sessions/scanner";
import { listWorkspaces, addWorkspace, removeWorkspace, archiveWorkspace, restoreWorkspace } from "./workspaces";
import { listFiles, warmCache } from "./files";
import { ProvidersStore, testProviderConnection } from "./providers";
import { pdfExtract, excelExtract, ocrRecognize, checkEnv, installRapidocr } from "./extension";
import { McpStore, ensureMcpExtension, testMcpServer } from "./mcp";
import { syncBundledPlugins, ensurePluginDeps } from "./plugins";

function homeDir(): string {
	return homedir();
}

const mcpStore = new McpStore(join(homeDir(), ".pi", "agent", "mcp.json"));
const mcpExtensionDir = join(homeDir(), ".pi", "agent", "extensions", "mcp");
let mcpExtensionReady: Promise<void> | null = null;
/** 确保 MCP 扩展已部署(SDK 缺失时自动 npm install),幂等 */
function ensureMcpExtensionDeployed(): Promise<void> {
	if (!mcpExtensionReady) {
		// 开发:项目根 extensions/;打包后:extraResources 里的 resources/extensions/
		const sourceDir = app.isPackaged
			? join(process.resourcesPath, "extensions", "mcp")
			: join(app.getAppPath(), "extensions", "mcp");
		mcpExtensionReady = ensureMcpExtension(
			sourceDir,
			mcpExtensionDir,
		).catch((err) => {
			mcpExtensionReady = null; // 失败后允许重试
			throw err;
		});
	}
	return mcpExtensionReady;
}

/* ---------------- 内置插件部署(启动时同步) ---------------- */
const userExtensionsDir = join(homeDir(), ".pi", "agent", "extensions");
let pluginsSync: Promise<string[]> | null = null;
function ensureBundledPlugins(): Promise<string[]> {
	if (!pluginsSync) {
		const sourceDir = app.isPackaged
			? join(process.resourcesPath, "extensions", "bundled")
			: join(app.getAppPath(), "extensions", "bundled");
		pluginsSync = Promise.resolve()
			.then(() => syncBundledPlugins(sourceDir, userExtensionsDir, app.getVersion()))
			.then((changed) =>
				// pi 启动时会扫描 ~/.pi/agent/extensions/ 并加载全部扩展,
				// 依赖必须提前装好,否则 pi 因缺模块直接退出
				ensureBundledPluginDeps(sourceDir, userExtensionsDir).then(() => changed),
			);
		pluginsSync.catch(() => {
			pluginsSync = null; // 失败允许下次重试
		});
	}
	return pluginsSync;
}

/** 为所有内置插件(顶层目录)预装 npm 依赖,并发且幂等(已有 node_modules 的跳过) */
function ensureBundledPluginDeps(sourceDir: string, destDir: string): Promise<void> {
	let names: string[] = [];
	try {
		names = readdirSync(sourceDir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return Promise.resolve();
	}
	return Promise.all(names.map((name) => ensurePluginDeps(destDir, name).catch(() => {}))).then(
		() => undefined,
	);
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, pool: RpcClientPool): void {
	// 命令按 cwd 路由(进程懒启动;失败时 send 已 reject,Electron 会把错误抛回渲染进程)
	ipcMain.handle(IpcChannels.rpcCommand, async (_e, cwd: string, cmd: Record<string, unknown>) => {
		// pi 启动即加载全部内置扩展,首次命令前先确保其依赖已装好(失败不阻塞)
		await ensureBundledPlugins().catch(() => {});
		return pool.send(cwd, cmd);
	});

	ipcMain.handle(IpcChannels.sessionsList, async (_e, cwd?: string) => {
		const list = await scanSessions(pool.config.sessionsDir);
		return cwd ? list.filter((s) => s.cwd === cwd) : list;
	});

	ipcMain.handle(IpcChannels.configGet, (): PiConfig => pool.config);
	ipcMain.handle(IpcChannels.configSet, async (_e, patch: Partial<PiConfig>) => {
		writeConfigFile(patch);
		pool.reloadConfig();
		// 注意:清空("" 恢复自动)也算改动,不能只判真值
		if (patch.cliPath !== undefined || patch.nodePath !== undefined) pool.restartAll();
	});

	ipcMain.handle(IpcChannels.workspacesList, () => listWorkspaces(pool.config.sessionsDir));

	ipcMain.handle(IpcChannels.workspacesAdd, async (): Promise<string | null> => {
		const win = getWindow();
		if (!win) return null;
		const result = await dialog.showOpenDialog(win, {
			title: "选择工作区目录",
			defaultPath: pool.config.cwd,
			properties: ["openDirectory", "createDirectory"],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		const cwd = result.filePaths[0];
		addWorkspace(cwd);
		void warmCache(cwd); // 创建工作区即预热文件缓存
		return cwd;
	});

	ipcMain.handle(IpcChannels.workspacesRemove, (_e, cwd: string) => {
		// 先杀进程再除名,避免孤儿进程
		pool.kill(cwd);
		removeWorkspace(cwd);
	});

	ipcMain.handle(IpcChannels.workspacesArchive, (_e, cwd: string) => {
		pool.kill(cwd);
		archiveWorkspace(cwd);
	});

	ipcMain.handle(IpcChannels.workspacesRestore, (_e, cwd: string) => {
		restoreWorkspace(cwd);
	});

	/* ---------------- 模型提供商管理 ---------------- */
	// pi 启动时缓存 auth.json/models.json,变更后必须重启全部后端进程才生效
	const providers = new ProvidersStore(pool.config);

	ipcMain.handle(IpcChannels.providersList, () => ({
		builtins: providers.listBuiltins(),
		customs: providers.listCustoms(),
	}));

	ipcMain.handle(IpcChannels.providersSetKey, (_e, providerId: string, key: string) => {
		providers.setKey(providerId, key);
		pool.restartAll();
	});

	ipcMain.handle(IpcChannels.providersRemoveKey, (_e, providerId: string) => {
		providers.removeKey(providerId);
		pool.restartAll();
	});

	ipcMain.handle(IpcChannels.providersUpsertCustom, (_e, provider: CustomProvider, originalId?: string) => {
		providers.upsertCustom(provider, originalId);
		pool.restartAll();
	});

	ipcMain.handle(IpcChannels.providersRemoveCustom, (_e, providerId: string) => {
		providers.removeCustom(providerId);
		pool.restartAll();
	});

	ipcMain.handle(IpcChannels.providersGetKey, (_e, providerId: string) =>
		providers.getKey(providerId),
	);
	ipcMain.handle(IpcChannels.providersTest, (_e, req: ProviderTestRequest) =>
		testProviderConnection(req),
	);

	/* ---------------- MCP 服务器管理 ---------------- */
	// 配置写 ~/.pi/agent/mcp.json,由 MCP 扩展在 pi 启动时读取;保存后重启全部后端
	ipcMain.handle(IpcChannels.mcpList, async () => {
		await ensureMcpExtensionDeployed();
		return mcpStore.listServers();
	});
	ipcMain.handle(
		IpcChannels.mcpUpsert,
		async (_e, server: McpServerConfig, originalId?: string) => {
			await ensureMcpExtensionDeployed();
			mcpStore.upsertServer(server, originalId);
			pool.restartAll();
			return mcpStore.listServers();
		},
	);
	ipcMain.handle(IpcChannels.mcpRemove, async (_e, serverId: string) => {
		mcpStore.removeServer(serverId);
		pool.restartAll();
		return mcpStore.listServers();
	});
	ipcMain.handle(IpcChannels.mcpTest, async (_e, server: McpServerConfig) => {
		await ensureMcpExtensionDeployed();
		return testMcpServer(join(mcpExtensionDir, "probe.mjs"), server);
	});

	// 能力按钮:主进程弹框选文件 + 加载 pi 扩展解析,结果回填输入框(不走 LLM)
	ipcMain.handle(IpcChannels.ocrRecognize, async (_e, engine?: "tesseract" | "rapidocr") => {
		try { return await ocrRecognize(getWindow, pool.config.cliPath, engine, pool.config.pythonPath); }
		catch (err) { return `OCR 失败: ${(err as Error).message}`; }
	});
	ipcMain.handle(IpcChannels.envCheck, async () => {
		try { return await checkEnv(pool.config.cliPath, pool.config.nodePath, pool.config.pythonPath); }
		catch { return null; }
	});
	ipcMain.handle(IpcChannels.ocrInstallRapidocr, async () => {
		try {
			await installRapidocr((line) => getWindow()?.webContents.send(IpcChannels.ocrInstallProgress, line));
			return "ok";
		} catch (err) { return `安装失败: ${(err as Error).message}`; }
	});
	ipcMain.handle(IpcChannels.pdfExtract, async () => {
		try { return await pdfExtract(getWindow, pool.config.cliPath); }
		catch (err) { return `PDF 解析失败: ${(err as Error).message}`; }
	});
	ipcMain.handle(IpcChannels.excelExtract, async () => {
		try { return await excelExtract(getWindow, pool.config.cliPath); }
		catch (err) { return `Excel 解析失败: ${(err as Error).message}`; }
	});

	// 同步系统原生标题栏/边框主题(暗色下避免顶部发白)
	ipcMain.handle(IpcChannels.setNativeTheme, (_e, dark: boolean) => {
		nativeTheme.themeSource = dark ? "dark" : "light";
	});

	// 工作区文件扫描(@ 引用补全)
	ipcMain.handle(IpcChannels.filesList, async (_e, cwd: string, query: string) => {
		try { return await listFiles(cwd, query); }
		catch { return []; }
	});
	// 预热工作区文件缓存(激活时后台调)
	ipcMain.handle(IpcChannels.filesWarm, (_e, cwd: string) => {
		void warmCache(cwd);
	});

	// 会话删除/归档(操作 .jsonl 文件)
	ipcMain.handle(IpcChannels.sessionDelete, async (_e, filePath: string) => {
		try { await unlink(filePath); return true; } catch { return false; }
	});
	ipcMain.handle(IpcChannels.sessionArchive, async (_e, filePath: string) => {
		try { await rename(filePath, `${filePath}.archived`); return true; } catch { return false; }
	});

	// 事件与状态转发(带 cwd 信封)
	pool.on("event", (env) => {
		getWindow()?.webContents.send(IpcChannels.rpcEvent, env);
	});
	pool.on("status", (env) => {
		getWindow()?.webContents.send(IpcChannels.backendStatus, env);
	});

	// 启动即同步内置插件到 ~/.pi/agent/extensions/(幂等,失败不阻塞)
	void ensureBundledPlugins().catch((err) =>
		console.error("[plugins] 内置插件同步失败:", err),
	);
}
