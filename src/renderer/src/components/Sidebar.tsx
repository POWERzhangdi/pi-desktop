import { useEffect, useState } from "react";
import WorkspaceList from "./WorkspaceList";
import EnvSettingsDialog from "./EnvSettingsDialog";
import McpManagerPage from "./McpManagerPage";
import Tooltip from "./Tooltip";
import { useMcpStore } from "../store/useMcpStore";
import { useSessionStore } from "../store/useSessionStore";

/** 左侧栏:品牌顶栏 + workspace 列表 + 底部固定操作栏(添加工作区/设置) */
export default function Sidebar() {
	const addWorkspace = useSessionStore((s) => s.addWorkspace);
	const [envOpen, setEnvOpen] = useState(false);
	const [mcpOpen, setMcpOpen] = useState(false);
	const mcpServers = useMcpStore((s) => s.servers);
	const loadMcp = useMcpStore((s) => s.load);

	// 侧栏挂载即拉一次 MCP 配置(入口角标显示已启用数)
	useEffect(() => {
		void loadMcp();
	}, [loadMcp]);

	const enabledMcpCount = mcpServers.filter((s) => s.enabled).length;

	return (
		<aside className="w-[260px] shrink-0 bg-side border-r border-sep flex flex-col">
			{/* 顶栏:与右侧 StatusBar 同高(h-11),border-b 对齐成一条连续分隔线 */}
			<div className="h-11 shrink-0 px-3 flex items-center gap-2 border-b border-sep">
				<span className="text-xl font-bold text-accent select-none">pi</span>
			</div>

			<WorkspaceList />

			{/* 底部固定操作栏 */}
			<div className="shrink-0 flex items-center gap-1 px-3 py-2 border-t border-sep">
				<div className="flex-1" />
				<button
					onClick={() => void addWorkspace()}
					title="添加工作区"
					className="btn-press w-8 h-8 flex items-center justify-center text-txt2 hover:text-accent rounded-lg hover:bg-card"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
				</button>
				<Tooltip
					label={
						enabledMcpCount > 0
							? `MCP 服务器 · 已连接 ${enabledMcpCount} 个`
							: "MCP 服务器 · 未启用"
					}
				>
					<button
						onClick={() => setMcpOpen(true)}
						className="btn-press w-8 h-8 flex items-center justify-center text-txt2 hover:text-accent rounded-lg hover:bg-card"
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" /></svg>
					</button>
				</Tooltip>
				<button
					onClick={() => setEnvOpen(true)}
					title="设置"
					className="btn-press w-8 h-8 flex items-center justify-center text-txt2 hover:text-accent rounded-lg hover:bg-card"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
				</button>
			</div>

			<EnvSettingsDialog open={envOpen} onClose={() => setEnvOpen(false)} />
			<McpManagerPage open={mcpOpen} onClose={() => setMcpOpen(false)} />
		</aside>
	);
}
