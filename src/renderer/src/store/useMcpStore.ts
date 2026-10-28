/**
 * MCP 服务器配置 store:列表 / 保存 / 删除 / 测试连接。
 * 保存与删除会重启全部 pi 后端(mcp.json 由扩展在进程启动时读取),
 * 有任务在跑时先弹确认(与模型/密钥管理一致)。
 */
import { create } from "zustand";
import type { McpServerConfig, McpTestResult } from "../../../shared/ipc";
import { useSessionStore } from "./useSessionStore";
import { confirmRestartIfBusy } from "./busy";


interface McpStoreState {
	servers: McpServerConfig[];
	loaded: boolean;
	load: () => Promise<void>;
	/** 保存成功返回 true(失败或用户取消返回 false) */
	save: (server: McpServerConfig, originalId?: string) => Promise<boolean>;
	remove: (serverId: string) => Promise<void>;
	test: (server: McpServerConfig) => Promise<McpTestResult>;
}

export const useMcpStore = create<McpStoreState>()((set) => ({
	servers: [],
	loaded: false,

	load: async () => {
		try {
			const servers = await window.piApi.listMcpServers();
			set({ servers, loaded: true });
		} catch (err) {
			useSessionStore
				.getState()
				.pushToast(`加载 MCP 配置失败:${(err as Error).message}`, "error");
		}
	},

	save: async (server, originalId) => {
		if (!(await confirmRestartIfBusy())) return false;
		try {
			const servers = await window.piApi.saveMcpServer(server, originalId);
			set({ servers, loaded: true });
			useSessionStore.getState().pushToast("MCP 配置已保存,后端已重启", "info");
			// 后端整体重启后,恢复当前工作区的模型偏好与状态
			void useSessionStore.getState().reloadModels().catch(() => {});
			return true;
		} catch (err) {
			useSessionStore
				.getState()
				.pushToast(`保存 MCP 配置失败:${(err as Error).message}`, "error");
			return false;
		}
	},

	remove: async (serverId) => {
		if (!(await confirmRestartIfBusy())) return;
		try {
			const servers = await window.piApi.removeMcpServer(serverId);
			set({ servers, loaded: true });
			useSessionStore.getState().pushToast("已删除 MCP 服务器,后端已重启", "info");
			void useSessionStore.getState().reloadModels().catch(() => {});
		} catch (err) {
			useSessionStore.getState().pushToast(`删除 MCP 服务器失败:${(err as Error).message}`, "error");
		}
	},

	test: (server) => window.piApi.testMcpServer(server),
}));
