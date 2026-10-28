/**
 * 渲染端缩放:用 Electron webFrame.setZoomFactor(真浏览器缩放),
 * 等比放大全部内容、布局自动重排(含 fixed 覆盖层)。因子记忆存 localStorage。
 *
 * 除了状态栏的 − / + 按钮,应用菜单(Ctrl+= / Ctrl+- / Ctrl+0)也走这里,
 * 保证两边看到的是同一个数值。
 */
import { create } from "zustand";

// v2:默认改 120%,失效旧的 1.1 自动记忆(首屏不再持久化,之后默认变更无需再 bump)
const ZOOM_KEY = "pi-desktop-zoom-v2";

export const ZOOM_DEFAULT = 1.2;
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;

function clamp(f: number): number {
	return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(f * 100) / 100));
}

/** 读取记忆的缩放因子(无记忆返回默认值) */
export function readZoom(): number {
	try {
		const v = Number(localStorage.getItem(ZOOM_KEY));
		if (!Number.isNaN(v) && v >= ZOOM_MIN && v <= ZOOM_MAX) return clamp(v);
	} catch {
		/* localStorage 不可用 */
	}
	return ZOOM_DEFAULT;
}

/** 应用缩放:写入 localStorage + 设置 webFrame 缩放因子 */
export function applyZoom(f: number): void {
	const c = clamp(f);
	try {
		localStorage.setItem(ZOOM_KEY, String(c));
	} catch {
		/* 忽略 */
	}
	window.piApi.setZoomFactor(c);
}

interface ZoomState {
	factor: number;
	/** 设置到指定值(会夹紧并持久化) */
	set: (f: number) => void;
	/** 相对调整 */
	step: (delta: number) => void;
	/** 恢复默认 */
	reset: () => void;
}

export const useZoomStore = create<ZoomState>((set, get) => ({
	factor: readZoom(),
	set: (f) => {
		const c = clamp(f);
		if (c === get().factor) return;
		applyZoom(c);
		set({ factor: c });
	},
	step: (delta) => get().set(get().factor + delta),
	reset: () => get().set(ZOOM_DEFAULT),
}));
