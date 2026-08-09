/**
 * preload:以 contextBridge 暴露受限 API 给渲染进程(多 workspace 版)。
 */
import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import {
	IpcChannels,
	type PiApi,
	type RpcEventEnvelope,
	type BackendStatusEnvelope,
} from "../shared/ipc";

const api: PiApi = {
	platform: process.platform,
	sendCommand: (cwd, cmd) => ipcRenderer.invoke(IpcChannels.rpcCommand, cwd, cmd),

	onRpcEvent: (cb) => {
		const listener = (_e: IpcRendererEvent, env: RpcEventEnvelope) => cb(env);
		ipcRenderer.on(IpcChannels.rpcEvent, listener);
		return () => {
			ipcRenderer.removeListener(IpcChannels.rpcEvent, listener);
		};
	},

	onBackendStatus: (cb) => {
		const listener = (_e: IpcRendererEvent, env: BackendStatusEnvelope) => cb(env);
		ipcRenderer.on(IpcChannels.backendStatus, listener);
		return () => {
			ipcRenderer.removeListener(IpcChannels.backendStatus, listener);
		};
	},

	listSessions: (cwd) => ipcRenderer.invoke(IpcChannels.sessionsList, cwd),
	getConfig: () => ipcRenderer.invoke(IpcChannels.configGet),
	configSet: (patch) => ipcRenderer.invoke(IpcChannels.configSet, patch),
	listWorkspaces: () => ipcRenderer.invoke(IpcChannels.workspacesList),
	addWorkspace: () => ipcRenderer.invoke(IpcChannels.workspacesAdd),
	removeWorkspace: (cwd) => ipcRenderer.invoke(IpcChannels.workspacesRemove, cwd),
	archiveWorkspace: (cwd) => ipcRenderer.invoke(IpcChannels.workspacesArchive, cwd),
	restoreWorkspace: (cwd) => ipcRenderer.invoke(IpcChannels.workspacesRestore, cwd),
	listProviders: () => ipcRenderer.invoke(IpcChannels.providersList),
	setProviderKey: (providerId, key) => ipcRenderer.invoke(IpcChannels.providersSetKey, providerId, key),
	removeProviderKey: (providerId) => ipcRenderer.invoke(IpcChannels.providersRemoveKey, providerId),
	upsertCustomProvider: (provider, originalId) =>
		ipcRenderer.invoke(IpcChannels.providersUpsertCustom, provider, originalId),
	removeCustomProvider: (providerId) =>
		ipcRenderer.invoke(IpcChannels.providersRemoveCustom, providerId),
	getProviderKey: (providerId) => ipcRenderer.invoke(IpcChannels.providersGetKey, providerId),
	testProviderConnection: (req) => ipcRenderer.invoke(IpcChannels.providersTest, req),
	listMcpServers: () => ipcRenderer.invoke(IpcChannels.mcpList),
	saveMcpServer: (server, originalId) =>
		ipcRenderer.invoke(IpcChannels.mcpUpsert, server, originalId),
	removeMcpServer: (serverId) => ipcRenderer.invoke(IpcChannels.mcpRemove, serverId),
	testMcpServer: (server) => ipcRenderer.invoke(IpcChannels.mcpTest, server),
	ocrRecognize: (engine) => ipcRenderer.invoke(IpcChannels.ocrRecognize, engine),
	envCheck: () => ipcRenderer.invoke(IpcChannels.envCheck),
	ocrInstallRapidocr: () => ipcRenderer.invoke(IpcChannels.ocrInstallRapidocr),
	onOcrInstallProgress: (cb) => {
		const listener = (_e: IpcRendererEvent, line: string) => cb(line);
		ipcRenderer.on(IpcChannels.ocrInstallProgress, listener);
		return () => { ipcRenderer.removeListener(IpcChannels.ocrInstallProgress, listener); };
	},
	pdfExtract: () => ipcRenderer.invoke(IpcChannels.pdfExtract),
	excelExtract: () => ipcRenderer.invoke(IpcChannels.excelExtract),
	setNativeTheme: (dark) => ipcRenderer.invoke(IpcChannels.setNativeTheme, dark),
	listFiles: (cwd, query) => ipcRenderer.invoke(IpcChannels.filesList, cwd, query),
	filesWarm: (cwd) => ipcRenderer.invoke(IpcChannels.filesWarm, cwd),
	sessionDelete: (filePath) => ipcRenderer.invoke(IpcChannels.sessionDelete, filePath),
	sessionArchive: (filePath) => ipcRenderer.invoke(IpcChannels.sessionArchive, filePath),
	setZoomFactor: (f: number) => webFrame.setZoomFactor(f),
};

contextBridge.exposeInMainWorld("piApi", api);
