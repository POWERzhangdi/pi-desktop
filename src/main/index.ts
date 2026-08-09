/**
 * Electron 主进程入口(多 workspace 版)。
 * pi 进程不再随窗口启动自动拉起——渲染进程确定 activeCwd 后,
 * 第一条命令经 RpcClientPool 懒启动对应进程。
 */
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { RpcClientPool } from "./rpc/pool";
import { registerIpcHandlers } from "./ipc";

const pool = new RpcClientPool();
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 600,
		backgroundColor: "#FBFAF9",
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.mjs"),
			contextIsolation: true,
			sandbox: false,
		},
	});

	// electron-vite 约定:dev 走 dev server URL,生产加载打包产物
	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	}

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

app.whenReady().then(() => {
	registerIpcHandlers(() => mainWindow, pool);
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	pool.disposeAll();
	app.quit();
});
