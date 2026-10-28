/**
 * IPC 注册:只做「参数转发 + 安全校验」,业务落在 services/ 与各自模块里。
 * 事件/状态以 {cwd, ...} 信封回传渲染进程。
 */
import { dialog, ipcMain, nativeTheme, type BrowserWindow } from "electron";
import {
	APPROVAL_CONFIRM_TITLE,
	IpcChannels,
	type ApprovalMode,
	type CustomProvider,
	type McpServerConfig,
	type PiConfig,
	type ProviderTestRequest,
} from "../shared/ipc";
import type { RpcClientPool } from "./rpc/pool";
import { writeConfigFile } from "./config/store";
import { scanSessions } from "./sessions/scanner";
import { archiveSessionFile, deleteSessionFile } from "./sessions/ops";
import { listWorkspaces, addWorkspace, removeWorkspace, archiveWorkspace, restoreWorkspace } from "./workspaces";
import { listFiles, warmCache } from "./files";
import { ProvidersStore, testProviderConnection } from "./providers";
import { pdfExtract, excelExtract, ocrRecognize, checkEnv, installRapidocr } from "./extension";
import { ApprovalPolicy } from "./approval";
import { McpService } from "./services/mcp-service";
import { PluginsService } from "./services/plugins-service";
import { openExternalSafely } from "./util/external";

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, pool: RpcClientPool): void {
	const providers = new ProvidersStore(() => pool.config);
	const approval = new ApprovalPolicy();
	const mcp = new McpService();
	const plugins = new PluginsService();

	/* ---------------- RPC ---------------- */
	// 命令按 cwd 路由(进程懒启动;失败时 send 已 reject,Electron 会把错误抛回渲染进程)
	ipcMain.handle(IpcChannels.rpcCommand, async (_e, cwd: string, cmd: Record<string, unknown>) => {
		// pi 启动即加载全部内置扩展:首次命令前等插件就位(有超时,不会无限等待)
		await plugins.ensureBeforeCommand();
		return pool.send(cwd, cmd);
	});

	/* ---------------- 配置 ---------------- */
	ipcMain.handle(IpcChannels.configGet, (): PiConfig => pool.config);
	ipcMain.handle(IpcChannels.configSet, (_e, patch: Partial<PiConfig>) => {
		writeConfigFile(patch);
		pool.reloadConfig();
		// 注意:清空("" 恢复自动)也算改动,不能只判真值
		if (patch.cliPath !== undefined || patch.nodePath !== undefined) pool.restartAll();
	});

	/* ---------------- 会话 ---------------- */
	ipcMain.handle(IpcChannels.sessionsList, async (_e, cwd?: string) => {
		const list = await scanSessions(pool.config.sessionsDir);
		return cwd ? list.filter((s) => s.cwd === cwd) : list;
	});
	ipcMain.handle(IpcChannels.sessionDelete, (_e, filePath: string) =>
		deleteSessionFile(pool.config.sessionsDir, filePath),
	);
	ipcMain.handle(IpcChannels.sessionArchive, (_e, filePath: string) =>
		archiveSessionFile(pool.config.sessionsDir, filePath),
	);

	/* ---------------- 工作区 ---------------- */
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

	/* ---------------- 模型提供商 ---------------- */
	// pi 启动时缓存 auth.json/models.json,任何变更后必须重启全部后端进程才生效
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
	ipcMain.handle(IpcChannels.providersTest, (_e, req: ProviderTestRequest) =>
		// 明文 key 不出主进程:未填 key 时由 store 从 auth.json 取
		testProviderConnection(req, (id) => providers.getKey(id)),
	);

	/* ---------------- MCP ---------------- */
	// 配置写 ~/.pi/agent/mcp.json,由扩展在 pi 启动时读取;保存后重启全部后端
	ipcMain.handle(IpcChannels.mcpList, async () => {
		await mcp.ensureDeployed();
		return mcp.listServers();
	});
	ipcMain.handle(IpcChannels.mcpUpsert, async (_e, server: McpServerConfig, originalId?: string) => {
		await mcp.ensureDeployed();
		const servers = mcp.upsert(server, originalId);
		pool.restartAll();
		return servers;
	});
	ipcMain.handle(IpcChannels.mcpRemove, async (_e, serverId: string) => {
		const servers = mcp.remove(serverId);
		pool.restartAll();
		return servers;
	});
	ipcMain.handle(IpcChannels.mcpTest, async (_e, server: McpServerConfig) => {
		await mcp.ensureDeployed();
		return mcp.test(server);
	});

	/* ---------------- 能力按钮(不走 LLM) ---------------- */
	ipcMain.handle(IpcChannels.ocrRecognize, async (_e, engine?: "tesseract" | "rapidocr") => {
		try {
			return await ocrRecognize(getWindow, pool.config.cliPath, engine, pool.config.pythonPath);
		} catch (err) {
			return `OCR 失败: ${(err as Error).message}`;
		}
	});
	ipcMain.handle(IpcChannels.pdfExtract, async () => {
		try {
			return await pdfExtract(getWindow, pool.config.cliPath);
		} catch (err) {
			return `PDF 解析失败: ${(err as Error).message}`;
		}
	});
	ipcMain.handle(IpcChannels.excelExtract, async () => {
		try {
			return await excelExtract(getWindow, pool.config.cliPath);
		} catch (err) {
			return `Excel 解析失败: ${(err as Error).message}`;
		}
	});
	ipcMain.handle(IpcChannels.envCheck, async () => {
		try {
			return await checkEnv(pool.config.cliPath, pool.config.nodePath, pool.config.pythonPath);
		} catch {
			return null;
		}
	});
	ipcMain.handle(IpcChannels.ocrInstallRapidocr, async () => {
		try {
			await installRapidocr((line) =>
				getWindow()?.webContents.send(IpcChannels.ocrInstallProgress, line),
			);
			return "ok";
		} catch (err) {
			return `安装失败: ${(err as Error).message}`;
		}
	});

	/* ---------------- 文件扫描(@ 引用) ---------------- */
	ipcMain.handle(IpcChannels.filesList, async (_e, cwd: string, query: string) => {
		try {
			return await listFiles(cwd, query);
		} catch {
			return [];
		}
	});
	ipcMain.handle(IpcChannels.filesWarm, (_e, cwd: string) => {
		void warmCache(cwd);
	});

	/* ---------------- 外链与命令审批 ---------------- */
	ipcMain.handle(IpcChannels.openExternal, (_e, url: string) => {
		openExternalSafely(String(url));
	});
	ipcMain.handle(IpcChannels.approvalGet, () => approval.allModes());
	ipcMain.handle(IpcChannels.approvalSet, (_e, cwd: string, mode: ApprovalMode) => {
		approval.setMode(cwd, mode);
	});
	ipcMain.handle(IpcChannels.approvalAutoTurn, (_e, cwd: string, on: boolean) => {
		approval.setAutoTurn(cwd, Boolean(on));
	});

	/* ---------------- 主题 ---------------- */
	// 同步系统原生标题栏/边框主题(暗色下避免顶部发白)
	ipcMain.handle(IpcChannels.setNativeTheme, (_e, dark: boolean) => {
		nativeTheme.themeSource = dark ? "dark" : "light";
	});

	/* ---------------- 事件与状态转发 ---------------- */
	pool.on("event", (env) => {
		const evt = env.evt;
		if (evt.type === "agent_start") {
			// 新一轮开始,清掉上一轮的"自动批准"
			approval.beginTurn(env.cwd);
		} else if (
			evt.type === "extension_ui_request" &&
			evt.method === "confirm" &&
			evt.title === APPROVAL_CONFIRM_TITLE &&
			approval.shouldAutoApprove(env.cwd)
		) {
			// 完全访问/本轮自动批准:主进程直接放行,事件不下发渲染进程
			const id = evt.id;
			if (typeof id === "string") {
				void pool
					.send(env.cwd, { type: "extension_ui_response", id, confirmed: true })
					.catch((err) => console.error("[approval] 自动放行失败:", err));
			}
			return;
		}
		getWindow()?.webContents.send(IpcChannels.rpcEvent, env);
	});
	pool.on("status", (env) => {
		getWindow()?.webContents.send(IpcChannels.backendStatus, env);
	});

	// 启动即同步内置插件(幂等,失败不阻塞;后续由 ensureBeforeCommand 兜底)
	void plugins.ensure().catch((err) => console.error("[plugins] 内置插件同步失败:", err));
}
