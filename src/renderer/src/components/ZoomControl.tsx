import { useState } from "react";
import { applyZoom, readZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from "../store/zoom";

/** 状态栏缩放控件:− [110%] +,localStorage 记忆,webFrame 真缩放 */
export default function ZoomControl() {
	const [factor, setFactor] = useState(() => readZoom());
	const pct = Math.round(factor * 100);

	const change = (delta: number) => {
		const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor + delta));
		if (next === factor) return;
		setFactor(next);
		applyZoom(next);
	};

	return (
		<div className="flex items-center gap-0.5 shrink-0">
			<button
				onClick={() => change(-ZOOM_STEP)}
				disabled={factor <= ZOOM_MIN + 1e-9}
				title="缩小"
				className="w-6 h-6 rounded-lg text-txt2 hover:text-accent hover:bg-side disabled:opacity-30 flex items-center justify-center btn-press"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
			</button>
			<span
				className="text-xs text-txt2 tabular-nums w-10 text-center"
				title="界面缩放(Ctrl+滚轮 也可微调)"
			>
				{pct}%
			</span>
			<button
				onClick={() => change(ZOOM_STEP)}
				disabled={factor >= ZOOM_MAX - 1e-9}
				title="放大"
				className="w-6 h-6 rounded-lg text-txt2 hover:text-accent hover:bg-side disabled:opacity-30 flex items-center justify-center btn-press"
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
			</button>
		</div>
	);
}
