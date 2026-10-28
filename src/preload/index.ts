/**
 * preload:以 contextBridge 暴露受限 API 给渲染进程(多 workspace 版)。
 *
 * 安全前提:sandbox + contextIsolation,渲染进程没有 Node 能力;
 * 这里暴露的每个方法都必须对应主进程显式注册的 channel。
 * method<K>() 从 PiApi 反推参数/返回类型,channel 名受 IpcChannels 约束,
 * 写错 channel 或漏实现某个方法都会编译失败。
 */
import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import {
	IpcChannels,
	type PiApi,
	type RpcEventEnvelope,
	type BackendStatusEnvelope,
	type AppCommand,
} from "../shared/ipc";

type Channel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** PiApi 里的「方法名」子集(排除 platform 这类普通字段) */
type ApiMethod = {
	[K in keyof PiApi]: PiApi[K] extends (...args: never[]) => unknown ? K : never;
}[keyof PiApi];

/** 声明一个「只做 IPC 透传」的方法:类型取自 PiApi,channel 取自 IpcChannels */
function method<K extends ApiMethod>(channel: Channel): PiApi[K] {
	return ((...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as unknown as PiApi[K];
}

/** 订阅类通道:返回取消订阅函数 */
function subscribe<T>(channel: Channel, cb: (payload: T) => void): () => void {
	const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.removeListener(channel, listener);
	};
}

const api: PiApi = {
	platform: process.platform,

	// RPC 与订阅
	sendCommand: method<"sendCommand">(IpcChannels.rpcCommand),
	onRpcEvent: (cb) => subscribe<RpcEventEnvelope>(IpcChannels.rpcEvent, cb),
	onBackendStatus: (cb) => subscribe<BackendStatusEnvelope>(IpcChannels.backendStatus, cb),

	// 会话与配置
	listSessions: method<"listSessions">(IpcChannels.sessionsList),
	getConfig: method<"getConfig">(IpcChannels.configGet),
	configSet: method<"configSet">(IpcChannels.configSet),
	sessionDelete: method<"sessionDelete">(IpcChannels.sessionDelete),
	sessionArchive: method<"sessionArchive">(IpcChannels.sessionArchive),

	// 工作区
	listWorkspaces: method<"listWorkspaces">(IpcChannels.workspacesList),
	addWorkspace: method<"addWorkspace">(IpcChannels.workspacesAdd),
	removeWorkspace: method<"removeWorkspace">(IpcChannels.workspacesRemove),
	archiveWorkspace: method<"archiveWorkspace">(IpcChannels.workspacesArchive),
	restoreWorkspace: method<"restoreWorkspace">(IpcChannels.workspacesRestore),

	// 模型与密钥(明文 key 不回传渲染进程)
	listProviders: method<"listProviders">(IpcChannels.providersList),
	setProviderKey: method<"setProviderKey">(IpcChannels.providersSetKey),
	removeProviderKey: method<"removeProviderKey">(IpcChannels.providersRemoveKey),
	upsertCustomProvider: method<"upsertCustomProvider">(IpcChannels.providersUpsertCustom),
	removeCustomProvider: method<"removeCustomProvider">(IpcChannels.providersRemoveCustom),
	testProviderConnection: method<"testProviderConnection">(IpcChannels.providersTest),

	// MCP
	listMcpServers: method<"listMcpServers">(IpcChannels.mcpList),
	saveMcpServer: method<"saveMcpServer">(IpcChannels.mcpUpsert),
	removeMcpServer: method<"removeMcpServer">(IpcChannels.mcpRemove),
	testMcpServer: method<"testMcpServer">(IpcChannels.mcpTest),

	// 能力按钮(主进程弹框 + 直接调扩展,不走 LLM)
	ocrRecognize: method<"ocrRecognize">(IpcChannels.ocrRecognize),
	envCheck: method<"envCheck">(IpcChannels.envCheck),
	ocrInstallRapidocr: method<"ocrInstallRapidocr">(IpcChannels.ocrInstallRapidocr),
	onOcrInstallProgress: (cb) => subscribe<string>(IpcChannels.ocrInstallProgress, cb),
	pdfExtract: method<"pdfExtract">(IpcChannels.pdfExtract),
	excelExtract: method<"excelExtract">(IpcChannels.excelExtract),

	// 文件与主题
	listFiles: method<"listFiles">(IpcChannels.filesList),
	filesWarm: method<"filesWarm">(IpcChannels.filesWarm),
	setNativeTheme: method<"setNativeTheme">(IpcChannels.setNativeTheme),

	// 外链与命令审批
	openExternal: method<"openExternal">(IpcChannels.openExternal),
	getApprovalModes: method<"getApprovalModes">(IpcChannels.approvalGet),
	setApprovalMode: method<"setApprovalMode">(IpcChannels.approvalSet),
	setAutoApproveTurn: method<"setAutoApproveTurn">(IpcChannels.approvalAutoTurn),

	// 纯 renderer 能力(不经 IPC)
	setZoomFactor: (f: number) => webFrame.setZoomFactor(f),

	// 应用菜单/快捷键
	onAppCommand: (cb) => subscribe<AppCommand>(IpcChannels.appCommand, cb),
};

contextBridge.exposeInMainWorld("piApi", api);
