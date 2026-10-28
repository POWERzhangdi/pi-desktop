/**
 * MCP 服务器管理页(全屏覆盖层,风格对齐 ModelManagerPage)。
 * 左侧栏的 🔌 入口打开;设置面板的"MCP 服务器"tab 直接复用 McpManagerPanel,不重复实现。
 * Esc / 点遮罩关闭由 Modal 统一处理。
 */
import McpManagerPanel from "./McpManagerPanel";
import Modal from "./Modal";

export default function McpManagerPage({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	if (!open) return null;

	return (
		<Modal
			open
			onClose={onClose}
			labelledBy="mcp-title"
			className="w-full max-w-3xl h-[82vh] flex flex-col overflow-hidden"
		>
			<div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-sep">
				<div>
					<h2 id="mcp-title" className="text-base font-semibold">
						MCP 服务器
					</h2>
					<p className="text-[11px] text-txt2 mt-0.5">
						通过扩展把 MCP 工具注册给 pi,重启后端后对全部工作区生效
					</p>
				</div>
				<button
					onClick={onClose}
					title="关闭(Esc)"
					className="btn-press w-7 h-7 flex items-center justify-center text-txt2 hover:text-txt rounded-lg hover:bg-side"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>
			<div className="flex-1 overflow-auto px-6 py-5">
				<McpManagerPanel />
			</div>
		</Modal>
	);
}
