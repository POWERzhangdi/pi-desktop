import { useZoomStore, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../store/zoom";

/** 状态栏缩放控件:− [110%] +,localStorage 记忆,webFrame 真缩放(菜单快捷键共用同一份状态) */
export default function ZoomControl() {
	const factor = useZoomStore((s) => s.factor);
	const set = useZoomStore((s) => s.set);
	const pct = Math.round(factor * 100);

	const change = (delta: number) => set(factor + delta);

	return (
		<div className="flex items-center gap-0.5 shrink-0">
			<button
				onClick={() => change(-ZOOM_STEP)}
				disabled={factor <= ZOOM_MIN + 1e-9}
				title={`缩小(当前 ${pct}%)`}
				aria-label="缩小"
				className="w-6 h-6 rounded-lg text-txt2 hover:text-accent hover:bg-side disabled:opacity-30 flex items-center justify-center btn-press"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
			</button>
			<span
				className="hidden lg:block text-xs text-txt2 tabular-nums w-10 text-center"
				title="界面缩放(Ctrl+= / Ctrl+- 也可调整)"
			>
				{pct}%
			</span>
			<button
				onClick={() => change(ZOOM_STEP)}
				disabled={factor >= ZOOM_MAX - 1e-9}
				title={`放大(当前 ${pct}%)`}
				aria-label="放大"
				className="w-6 h-6 rounded-lg text-txt2 hover:text-accent hover:bg-side disabled:opacity-30 flex items-center justify-center btn-press"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			</button>
		</div>
	);
}
