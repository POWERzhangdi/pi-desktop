import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveWs, useSessionStore } from "../store/useSessionStore";
import { saveModelPref } from "../store/modelPrefs";
import type { Model } from "../../../shared/rpc-types";

/** thinking level 英文值 → 中文显示 */
const thinkingLevelLabel: Record<string, string> = {
	off: "关闭",
	minimal: "极简",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "极高",
	max: "最大",
};

/** 点击外部关闭的浮层容器 */
function Popover({
	button,
	children,
	disabled,
	title,
}: {
	button: React.ReactNode;
	children: (close: () => void) => React.ReactNode;
	disabled?: boolean;
	title?: string;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	return (
		<div ref={rootRef} className="relative">
			<button
				onClick={() => !disabled && setOpen((v) => !v)}
				disabled={disabled}
				title={title}
				className="btn-press flex items-center gap-1.5 h-7 rounded-lg px-2.5 text-xs hover:bg-side disabled:opacity-40 disabled:cursor-not-allowed max-w-[260px] transition-colors"
			>
				{button}
				<svg
					width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
					className={`shrink-0 text-txt2 transition-transform duration-150 ease-[var(--ease-out)] ${open ? "rotate-180" : ""}`}
				>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>
			{open && (
				<div
					className="animate-popover absolute left-0 top-full mt-1 z-30 bg-card border border-sep rounded-xl shadow-lg overflow-hidden"
					style={{ "--transform-origin": "top left" } as any}
				>
					{children(() => setOpen(false))}
				</div>
			)}
		</div>
	);
}

/** 模型选择器:按 provider 分组 + 搜索 + 元信息徽标 */
export function ModelPicker() {
	const models = useSessionStore((s) => s.models);
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const sessionState = useActiveWs((s) => s.sessionState);
	const refreshActive = useSessionStore((s) => s.refreshActive);
	const reloadThinkingLevels = useSessionStore((s) => s.reloadThinkingLevels);
	const pushToast = useSessionStore((s) => s.pushToast);
	const setModelManagerOpen = useSessionStore((s) => s.setModelManagerOpen);

	const [query, setQuery] = useState("");
	const currentKey = sessionState?.model ? `${sessionState.model.provider}/${sessionState.model.id}` : "";
	const currentProvider = sessionState?.model?.provider ?? "";
	// pi 未配置模型时返回 id/name 均为 "unknown" 的占位对象,视为"未配置"
	const isPlaceholder = !sessionState?.model || sessionState.model.id === "unknown";
	const [selProvider, setSelProvider] = useState(currentProvider);
	// 当前模型变化时,左侧供应商选中跟随(下次打开即定位到当前供应商)
	useEffect(() => {
		if (currentProvider) setSelProvider(currentProvider);
	}, [currentProvider]);

	// 按 provider 聚合;搜索过滤供应商
	const providers = useMemo(() => {
		const map = new Map<string, Model[]>();
		for (const m of models) {
			const list = map.get(m.provider) ?? [];
			list.push(m);
			map.set(m.provider, list);
		}
		const q = query.trim().toLowerCase();
		const entries = [...map.entries()];
		return q ? entries.filter(([p]) => p.toLowerCase().includes(q)) : entries;
	}, [models, query]);

	const effectiveProvider = providers.some(([p]) => p === selProvider)
		? selProvider
		: (providers[0]?.[0] ?? "");
	const rightModels = providers.find(([p]) => p === effectiveProvider)?.[1] ?? [];

	const onPick = async (m: Model, close: () => void) => {
		close();
		if (`${m.provider}/${m.id}` === currentKey) return;
		try {
			await window.piApi.sendCommand(activeCwd, { type: "set_model", provider: m.provider, modelId: m.id });
			saveModelPref(activeCwd, { provider: m.provider, modelId: m.id });
			await refreshActive();
			await reloadThinkingLevels();
		} catch (err) {
			pushToast(`切换模型失败:${(err as Error).message}`, "error");
		}
	};

	return (
		<Popover
			title={isPlaceholder ? "尚未配置模型" : currentKey || "选择模型"}
			button={
				<span className={`truncate ${isPlaceholder ? "text-orange" : ""}`}>
					{isPlaceholder ? "未配置模型" : sessionState?.model?.name ?? "选择模型"}
				</span>
			}
		>
			{(close) => (
				<div className="w-[480px] flex flex-col">
					<div className="p-2 border-b border-sep">
						<input
							autoFocus
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="搜索供应商…"
							className="w-full bg-ground border border-sep rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
						/>
					</div>
					{providers.length === 0 ? (
						<div className="px-3 py-6 text-xs text-txt2 text-center">
							{query.trim()
								? "无匹配供应商"
								: "尚未配置模型,请到下方「管理模型」添加供应商和 API Key"}
						</div>
					) : (
						<div className="flex max-h-80">
							{/* 左:供应商 */}
							<div className="w-[176px] shrink-0 border-r border-sep overflow-y-auto py-1">
								{providers.map(([p]) => (
									<button
										key={p}
										onClick={() => setSelProvider(p)}
										className={`w-full text-left px-3 py-1.5 text-sm truncate ${
											p === effectiveProvider ? "bg-accent-soft text-accent" : "hover:bg-side"
										}`}
									>
										{p}
									</button>
								))}
							</div>
							{/* 右:该供应商的模型 */}
							<div className="flex-1 overflow-y-auto py-1">
								{rightModels.map((m) => {
									const key = `${m.provider}/${m.id}`;
									const isCurrent = key === currentKey;
									return (
										<button
											key={key}
											onClick={() => void onPick(m, close)}
											className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm ${
												isCurrent ? "text-accent" : "hover:bg-side"
											}`}
										>
											<span className="flex-1 min-w-0 truncate">{m.name || m.id}</span>
											{m.reasoning && (
												<span className="shrink-0 text-[10px] rounded px-1 py-0.5 bg-purple/15 text-purple">思考</span>
											)}
											{(m.contextWindow ?? 0) > 0 && (
												<span className="shrink-0 text-[10px] text-txt2">
													{Math.round(m.contextWindow! / 1024)}k
												</span>
											)}
											{isCurrent && <span className="shrink-0 text-accent">✓</span>}
										</button>
									);
								})}
							</div>
						</div>
					)}
					<div className="border-t border-sep p-1">
						<button
							onClick={() => {
								close();
								setModelManagerOpen(true);
							}}
							className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-side rounded-lg flex items-center gap-1.5"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
								<circle cx="12" cy="12" r="3" />
								<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
							</svg>
							管理模型
						</button>
					</div>
				</div>
			)}
		</Popover>
	);
}

/** 思考等级选择器(中文显示;模型不支持 reasoning 时禁用) */
export function ThinkingPicker() {
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const thinkingLevels = useSessionStore((s) => s.thinkingLevels);
	const sessionState = useActiveWs((s) => s.sessionState);
	const refreshActive = useSessionStore((s) => s.refreshActive);
	const pushToast = useSessionStore((s) => s.pushToast);

	const supported = sessionState?.model?.reasoning ?? false;
	const current = sessionState?.thinkingLevel ?? "off";
	const levels = thinkingLevels.length > 0 ? thinkingLevels : (["off"] as const);

	const onPick = async (level: string, close: () => void) => {
		close();
		if (level === current) return;
		try {
			await window.piApi.sendCommand(activeCwd, { type: "set_thinking_level", level });
			saveModelPref(activeCwd, { thinkingLevel: level });
			await refreshActive();
		} catch (err) {
			pushToast(`设置思考等级失败:${(err as Error).message}`, "error");
		}
	};

	return (
		<Popover
			disabled={!supported}
			title={supported ? `思考等级:${thinkingLevelLabel[current] ?? current}` : "当前模型不支持思考"}
			button={
				<>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0"
					>
						<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
						<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
						<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
					</svg>
					<span className="text-xs">{thinkingLevelLabel[current] ?? current}</span>
				</>
			}
		>
			{(close) => (
				<div className="w-32 py-1">
					{levels.map((lv) => (
						<button
							key={lv}
							onClick={() => void onPick(lv, close)}
							className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
								lv === current ? "text-accent" : "hover:bg-side"
							}`}
						>
							<span className="flex-1">{thinkingLevelLabel[lv] ?? lv}</span>
							{lv === current && <span className="text-accent">✓</span>}
						</button>
					))}
				</div>
			)}
		</Popover>
	);
}
