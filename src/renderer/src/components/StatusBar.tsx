import { useEffect, useRef, useState } from "react";
import { useActiveWs, useSessionStore } from "../store/useSessionStore";
import { ModelPicker, ThinkingPicker } from "./ModelPicker";
import ThemeToggle from "./ThemeToggle";
import ZoomControl from "./ZoomControl";
import Tooltip from "./Tooltip";

/** 竖向分隔线 */
function Divider() {
	return <span className="w-px h-4 bg-sep mx-2 shrink-0" />;
}

/** 上下文占用环形进度(20px,颜色随占用:绿<60 / 橙60-80 / 红>80);有数据时为可点击按钮触发手动压缩 */
function ContextRing({
	percent,
	compacting,
	onCompact,
}: {
	percent: number | null;
	compacting: boolean;
	onCompact: () => void;
}) {
	const p = percent ?? 0;
	const color = p > 80 ? "text-red" : p > 60 ? "text-orange" : "text-green";
	const r = 7;
	const c = 2 * Math.PI * r;
	const offset = c * (1 - Math.min(100, p) / 100);
	const hasData = percent != null;
	const title = compacting
		? "正在压缩上下文…"
		: hasData
			? "点击手动压缩上下文"
			: "上下文窗口占用";
	// 有数据且未在压缩时渲染为可点击 button;否则为纯展示 span
	const interactive = hasData && !compacting;
	const interactiveCls = interactive ? "cursor-pointer hover:opacity-80 transition" : "";
	const disabledCls = compacting ? "opacity-40 cursor-not-allowed" : "";
	return (
		<Tooltip label={title}>
			<button
				onClick={interactive ? onCompact : undefined}
				disabled={!interactive}
				className={`flex items-center gap-1 ${color} ${interactiveCls} ${disabledCls}`}
			>
				<svg width="20" height="20" viewBox="0 0 20 20">
					<circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
					<circle
						cx="10"
						cy="10"
						r={r}
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeDasharray={c}
						strokeDashoffset={offset}
						transform="rotate(-90 10 10)"
						style={{ transition: "stroke-dashoffset 300ms var(--ease-out)" }}
					/>
				</svg>
				{percent != null ? `${p.toFixed(0)}%` : "-"}
			</button>
		</Tooltip>
	);
}

/** 顶部状态栏:左侧模型/思考选择器 → 分隔 → 用量统计;中间弹性区放扩展状态;右端主题切换 */
export default function StatusBar() {
	const stats = useActiveWs((s) => s.stats);
	const statusEntries = useActiveWs((s) => s.statusEntries);
	const pendingCount = useActiveWs((s) => s.pendingCount);
	const isStreaming = useActiveWs((s) => s.isStreaming);
	const refreshActive = useSessionStore((s) => s.refreshActive);
	const compact = useSessionStore((s) => s.compact);

	// agent 一轮结束(isStreaming true→false)后刷新统计
	const prevStreaming = useRef(isStreaming);
	useEffect(() => {
		if (prevStreaming.current && !isStreaming) {
			void refreshActive();
		}
		prevStreaming.current = isStreaming;
	}, [isStreaming, refreshActive]);

	const statusTexts = Object.values(statusEntries);
	const ctx = stats?.contextUsage;

	return (
		<div className="h-11 shrink-0 border-b border-sep bg-card/80 backdrop-blur-md flex items-center px-3 text-sm">
			{/* 选择器组(同高 ghost 按钮) */}
			<div className="flex items-center gap-2">
				<ModelPicker />
				<ThinkingPicker />
			</div>

			<Divider />

			{/* token / 成本 / 上下文用量 */}
			<div className="flex items-center gap-2.5 text-xs text-txt2 shrink-0 tabular-nums">
				{stats && (
					<>
						<span className="flex items-center gap-1" title="会话累计 tokens">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-accent"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>
							{stats.tokens.total < 1000 ? stats.tokens.total : `${(stats.tokens.total / 1000).toFixed(1)}k`}
						</span>
						<span className="flex items-center gap-1" title="会话累计成本">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
							${stats.cost < 0.01 ? stats.cost.toFixed(4) : stats.cost.toFixed(2)}
						</span>
					</>
				)}
				{ctx && (
					<ContextRing
						percent={ctx.percent ?? null}
						compacting={"compaction" in statusEntries}
						onCompact={() => void compact()}
					/>
				)}
			</div>

			{/* 中间弹性区:扩展状态文本 / 排队提示(出现时不挤压左侧布局) */}
			<div className="flex-1 min-w-0 flex items-center gap-2 px-3">
				{statusTexts.map((t, i) => (
					<span key={i} className="text-xs text-purple truncate">
						{t}
					</span>
				))}
				{pendingCount > 0 && (
					<span className="text-xs text-orange shrink-0">{pendingCount} 条排队中</span>
				)}
			</div>

			<Divider />
			<ZoomControl />
			<ThemeToggle />
		</div>
	);
}
