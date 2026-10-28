import { useEffect, useRef, useState } from "react";
import { useActiveWs, useSessionStore } from "../store/useSessionStore";
import MessageItem from "./MessageItem";

/** 默认渲染的消息窗口(超出部分折叠):长会话流式时只重建窗口内节点 */
const WINDOW_SIZE = 60;
/** 距底部多少像素内视为"贴着底部",只有此时才自动跟随滚动 */
const STICK_THRESHOLD = 48;

/** 消息流:窗口化渲染 + 只在用户停留底部时自动滚动(数据来自当前 workspace 桶) */
export default function MessageList() {
	const messages = useActiveWs((s) => s.messages);
	const isStreaming = useActiveWs((s) => s.isStreaming);
	const activeSessionFile = useActiveWs((s) => s.activeSessionFile);
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const hasWorkspace = useSessionStore((s) => s.workspaces.some((w) => w.cwd === s.activeCwd));
	const addWorkspace = useSessionStore((s) => s.addWorkspace);
	const setModelManagerOpen = useSessionStore((s) => s.setModelManagerOpen);
	const scrollRef = useRef<HTMLDivElement>(null);
	/** 用户是否停留在底部:向上翻阅历史时不能被流式输出抢走滚动条 */
	const stickRef = useRef(true);
	const [expanded, setExpanded] = useState(false);

	const truncated = !expanded && messages.length > WINDOW_SIZE;
	const visible = truncated ? messages.slice(-WINDOW_SIZE) : messages;

	// 切换工作区/切换会话:回到最新消息,并收起展开态。
	// 会话切换也必须重置——消息整体被替换后,旧的滚动位置会停在新会话中间。
	useEffect(() => {
		stickRef.current = true;
		setExpanded(false);
	}, [activeCwd, activeSessionFile]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !stickRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [messages, isStreaming, visible.length]);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
	};

	return (
		<div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
			<div className="max-w-[860px] mx-auto px-6 py-6">
				{truncated && (
					<button
						onClick={() => setExpanded(true)}
						className="btn-press mx-auto mb-3 block text-xs text-txt2 hover:text-accent rounded-full border border-sep px-3 py-1"
					>
						较早的 {messages.length - WINDOW_SIZE} 条消息已折叠 · 点击展开
					</button>
				)}
				{messages.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center text-txt2 pt-24">
						<span className="text-4xl font-bold text-accent mb-3">pi</span>
						{hasWorkspace ? (
							<p className="text-sm">在下方输入框开始新的对话</p>
						) : (
							<>
								<p className="text-sm mb-1">还没有工作区</p>
								<p className="text-xs opacity-70 mb-5">
									选一个项目目录,pi 会以它为工作目录启动
								</p>
								<div className="flex items-center gap-2">
									<button
										onClick={() => void addWorkspace()}
										className="btn-press bg-accent text-white rounded-lg px-4 py-2 text-sm hover:opacity-90"
									>
										添加工作区
									</button>
									<button
										onClick={() => setModelManagerOpen(true)}
										className="btn-press border border-sep rounded-lg px-4 py-2 text-sm hover:bg-side"
									>
										配置模型
									</button>
								</div>
							</>
						)}
					</div>
				) : (
					visible.map((m) => <MessageItem key={m.id} msg={m} />)
				)}
				{isStreaming && (
					<div className="flex items-center gap-1.5 text-txt2 py-3">
						<span className="pi-dot w-1.5 h-1.5 rounded-full bg-accent" />
						<span className="pi-dot w-1.5 h-1.5 rounded-full bg-accent" />
						<span className="pi-dot w-1.5 h-1.5 rounded-full bg-accent" />
					</div>
				)}
			</div>
		</div>
	);
}
