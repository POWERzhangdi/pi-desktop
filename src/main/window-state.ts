/**
 * 窗口几何记忆:关闭/移动/缩放时把 bounds 写到 userData/window-state.json,
 * 下次启动恢复;若记录的坐标已经不在任何屏幕内(拔掉外接屏),回退到默认尺寸并居中。
 */
import { app, screen, type BrowserWindow } from "electron";
import { join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./util/json-file";

export interface WindowState {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized: boolean;
}

const DEFAULT_STATE: WindowState = { width: 1440, height: 900, maximized: false };

function stateFile(): string {
	return join(app.getPath("userData"), "window-state.json");
}

/** 记录的区域是否至少有一块落在某个显示器的工作区内 */
function isVisible(state: WindowState): boolean {
	if (state.x === undefined || state.y === undefined) return true;
	return screen.getAllDisplays().some((d) => {
		const a = d.workArea;
		const overlapX = Math.min(state.x! + state.width, a.x + a.width) - Math.max(state.x!, a.x);
		const overlapY = Math.min(state.y! + state.height, a.y + a.height) - Math.max(state.y!, a.y);
		return overlapX > 120 && overlapY > 80;
	});
}

export function loadWindowState(): WindowState {
	const raw = readJsonFile<Partial<WindowState>>(stateFile(), {});
	const width = Number(raw.width);
	const height = Number(raw.height);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 800 || height < 500) {
		return { ...DEFAULT_STATE };
	}
	const state: WindowState = {
		x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : undefined,
		y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : undefined,
		width: Math.round(width),
		height: Math.round(height),
		maximized: raw.maximized === true,
	};
	if (!isVisible(state)) {
		return { width: state.width, height: state.height, maximized: state.maximized };
	}
	return state;
}

/** 挂上移动/缩放/关闭的持久化(合并 400ms 内的连续事件,避免拖动时狂写盘) */
export function trackWindowState(win: BrowserWindow): void {
	let timer: NodeJS.Timeout | null = null;

	const save = (): void => {
		if (win.isDestroyed() || win.isMinimized()) return;
		const b = win.getNormalBounds();
		writeJsonAtomic(stateFile(), {
			x: b.x,
			y: b.y,
			width: b.width,
			height: b.height,
			maximized: win.isMaximized(),
		});
	};

	const schedule = (): void => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(save, 400);
	};

	win.on("resize", schedule);
	win.on("move", schedule);
	win.on("close", () => {
		if (timer) clearTimeout(timer);
		save();
	});
}
