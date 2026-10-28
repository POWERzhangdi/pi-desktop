import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { confirmAction } from "../store/confirm";
import type { WorkspaceInfo } from "../../../shared/ipc";

/** 相对时间格式化 */
function relativeTime(mtimeMs: number): string {
	const diff = Date.now() - mtimeMs;
	const min = Math.floor(diff / 60_000);
	if (min < 1) return "刚刚";
	if (min < 60) return `${min} 分钟前`;
	const hour = Math.floor(min / 60);
	if (hour < 24) return `${hour} 小时前`;
	const day = Math.floor(hour / 24);
	if (day === 1) return "昨天";
	if (day < 7) return `${day} 天前`;
	const d = new Date(mtimeMs);
	return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 工作区状态图标(线条文件夹):运行中绿(呼吸) / 待确认橙 / 崩溃红 / 空闲灰 */
function StatusDot({ cwd }: { cwd: string }) {
	const isStreaming = useSessionStore((s) => s.byCwd[cwd]?.isStreaming ?? false);
	const needsConfirm = useSessionStore((s) => (s.byCwd[cwd]?.uiQueue.length ?? 0) > 0);
	const crashed = useSessionStore((s) => s.backendByCwd[cwd]?.state === "crashed");
	const cls = crashed
		? "text-red"
		: needsConfirm
			? "text-orange"
			: isStreaming
				? "text-green"
				: "text-txt2/50";
	return (
		<svg
			width="15"
			height="15"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={`shrink-0 ${cls}${isStreaming ? " animate-pulse" : ""}`}
		>
			<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
		</svg>
	);
}

/** 单个活跃 workspace 块:头部(状态点+名称+加号+菜单) + 展开的会话列表 */
function WorkspaceBlock({ w }: { w: WorkspaceInfo }) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const activeCwd = useSessionStore((s) => s.activeCwd);
	const expanded = useSessionStore((s) => s.expandedCwds[w.cwd] ?? w.cwd === s.activeCwd);
	const sessions = useSessionStore((s) => s.sessions);
	const activeSessionFile = useSessionStore((s) => s.byCwd[w.cwd]?.activeSessionFile);
	const setActive = useSessionStore((s) => s.setActive);
	const toggleExpanded = useSessionStore((s) => s.toggleExpanded);
	const newSessionIn = useSessionStore((s) => s.newSessionIn);
	const openSession = useSessionStore((s) => s.openSession);
	const deleteSession = useSessionStore((s) => s.deleteSession);
	const archiveSession = useSessionStore((s) => s.archiveSession);
	const archiveWorkspace = useSessionStore((s) => s.archiveWorkspace);
	const removeWorkspace = useSessionStore((s) => s.removeWorkspace);

	const isActive = w.cwd === activeCwd;
	const wsSessions = sessions.filter((s) => s.cwd === w.cwd);

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	return (
		<div className="rounded-xl mb-1">
			{/* 工作区头部:整行是容器,可点击区域独立成 button(否则内部按钮嵌套非法,键盘也无法聚焦) */}
			<div
				className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-xl transition-colors duration-150 ease-[var(--ease-out)] border-l-2 ${
					isActive ? "bg-accent-soft border-accent" : "border-transparent hover:bg-side"
				}`}
			>
				<button
					type="button"
					onClick={() => {
						if (!isActive) {
							void setActive(w.cwd);
							if (!expanded) toggleExpanded(w.cwd);
						} else {
							toggleExpanded(w.cwd);
						}
					}}
					title={w.cwd}
					aria-expanded={expanded}
					className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer rounded-md"
				>
					<StatusDot cwd={w.cwd} />
					<span className="flex-1 min-w-0 flex items-baseline gap-1.5">
						<span className={`text-sm truncate ${isActive ? "text-accent font-medium" : ""}`}>
							{w.name}
						</span>
						<span className="text-[10px] text-txt2 shrink-0">
							{w.sessionCount > 0 ? `${w.sessionCount} 会话` : "无会话"}
						</span>
					</span>
				</button>

				{/* 新会话加号(工作区右上角) */}
				<button
					onClick={(e) => {
						e.stopPropagation();
						void newSessionIn(w.cwd);
					}}
					title={`在「${w.name}」新建会话`}
					aria-label={`在「${w.name}」新建会话`}
					className="shrink-0 w-6 h-6 rounded-lg text-txt2 hover:text-accent hover:bg-accent-soft flex items-center justify-center btn-press opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity duration-150"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
				</button>

				{/* 归档/删除菜单 */}
				<div ref={menuRef} className="relative shrink-0">
					<button
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen((v) => !v);
						}}
						title="更多"
						aria-label={`「${w.name}」更多操作`}
						aria-expanded={menuOpen}
						className="btn-press w-6 h-6 rounded-lg text-txt2 hover:text-txt hover:bg-side flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
					</button>
					{menuOpen && (
						<div
							className="animate-popover absolute right-0 top-full mt-1 z-30 w-32 bg-card border border-sep rounded-xl shadow-lg overflow-hidden py-1"
							style={{ "--transform-origin": "top right" } as any}
						>
							<button
								onClick={(e) => {
									e.stopPropagation();
									setMenuOpen(false);
									void archiveWorkspace(w.cwd);
								}}
								className="w-full text-left text-sm px-3 py-1.5 hover:bg-side"
							>
								归档
							</button>
							<button
								onClick={(e) => {
									e.stopPropagation();
									setMenuOpen(false);
									void (async () => {
										const ok = await confirmAction({
											title: `删除工作区「${w.name}」?`,
											message: "仅从列表移除,不删除磁盘文件。\n有会话历史的目录需要手动重新添加才能找回。",
											confirmText: "删除",
											danger: true,
										});
										if (ok) await removeWorkspace(w.cwd);
									})();
								}}
								className="w-full text-left text-sm px-3 py-1.5 text-red hover:bg-red/10"
							>
								删除
							</button>
						</div>
					)}
				</div>
			</div>

			{/* 会话列表(仅展开时,上下文按工作区隔离) */}
			{expanded && (
				<div className="animate-list pb-1.5 pl-6 pr-1.5 mt-0.5">
					{wsSessions.length === 0 && (
						<div className="px-2 py-1 text-[11px] text-txt2">暂无会话,点 + 新建</div>
					)}
					{wsSessions.map((s) => (
						<div
							key={s.filePath}
							className={`group w-full text-left rounded-lg px-2 py-1.5 mb-0.5 transition-colors duration-150 flex items-center gap-1.5 border-l-2 ${
								s.filePath === activeSessionFile
									? "bg-purple/15 text-purple border-purple"
									: "border-transparent hover:bg-side"
							}`}
						>
							<button
								type="button"
								onClick={() => void openSession(w.cwd, s.filePath)}
								title={s.filePath}
								className="flex-1 min-w-0 flex items-center gap-1.5 text-left cursor-pointer rounded-md"
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-txt2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
								<span className="flex-1 min-w-0 flex items-baseline gap-1.5">
									<span className="text-xs truncate">{s.title}</span>
									<span className="text-[10px] text-txt2 shrink-0">{relativeTime(s.mtimeMs)}</span>
								</span>
							</button>
							<div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
								<button
									onClick={() => void archiveSession(s.filePath)}
									title="归档"
									aria-label={`归档会话「${s.title}」`}
									className="btn-press w-5 h-5 flex items-center justify-center text-txt2 hover:text-accent rounded"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /></svg>
								</button>
								<button
									onClick={() => {
										void (async () => {
											const ok = await confirmAction({
												title: "删除会话?",
												message: `「${s.title}」的会话记录(.jsonl)会被永久删除,无法恢复。\n想保留文件请改用"归档"。`,
												confirmText: "删除",
												danger: true,
											});
											if (ok) await deleteSession(s.filePath);
										})();
									}}
									title="删除"
									aria-label={`删除会话「${s.title}」`}
									className="btn-press w-5 h-5 flex items-center justify-center text-txt2 hover:text-red rounded"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** 已归档区(默认收起) */
function ArchivedSection({ items }: { items: WorkspaceInfo[] }) {
	const [open, setOpen] = useState(false);
	const restoreWorkspace = useSessionStore((s) => s.restoreWorkspace);
	const removeWorkspace = useSessionStore((s) => s.removeWorkspace);

	if (items.length === 0) return null;
	return (
		<div className="mt-2 border-t border-sep pt-1">
			<button
				onClick={() => setOpen((v) => !v)}
				className="btn-press w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-txt2 hover:text-txt rounded-lg"
			>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /></svg>
				已归档({items.length})
			</button>
			{open && (
				<div className="animate-list pb-1 pl-1">
					{items.map((w) => (
						<div key={w.cwd} className="group flex items-center gap-1.5 px-2 py-1 pl-4 rounded-lg hover:bg-side" title={w.cwd}>
							<span className="flex-1 min-w-0 text-xs text-txt2 truncate">{w.name}</span>
							<div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
								<button
									onClick={() => void restoreWorkspace(w.cwd)}
									title="恢复"
									aria-label={`恢复工作区「${w.name}」`}
									className="btn-press w-5 h-5 flex items-center justify-center text-txt2 hover:text-accent rounded"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
								</button>
								<button
									onClick={() => {
										void (async () => {
											const ok = await confirmAction({
												title: `彻底删除工作区「${w.name}」?`,
												message: "仅从列表移除,不删除磁盘文件。",
												confirmText: "删除",
												danger: true,
											});
											if (ok) await removeWorkspace(w.cwd);
										})();
									}}
									title="删除"
									aria-label={`彻底删除工作区「${w.name}」`}
									className="btn-press w-5 h-5 flex items-center justify-center text-txt2 hover:text-red rounded"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /></svg>
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** 侧栏主体:workspace 平铺列表(一工作区一块) + 归档区 + 添加入口 */
export default function WorkspaceList() {
	const workspaces = useSessionStore((s) => s.workspaces);

	const active = workspaces.filter((w) => !w.archived);
	const archived = workspaces.filter((w) => w.archived);

	return (
		<div className="flex-1 overflow-y-auto px-2 py-2">
			{active.length === 0 && (
				<div className="px-3 py-6 text-xs text-txt2">还没有工作区,点击下方添加</div>
			)}
			{active.map((w) => (
				<WorkspaceBlock key={w.cwd} w={w} />
			))}

			<ArchivedSection items={archived} />
		</div>
	);
}
