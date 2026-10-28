/**
 * 主题状态:localStorage > 系统偏好;用户手动切换后才停止跟随系统。
 * main.tsx 在首屏渲染前读 initialDark() 避免白闪,组件通过 useThemeStore 订阅。
 */
import { create } from "zustand";

const THEME_KEY = "pi-desktop-theme";

/** 是否已由用户显式选择过 */
export function hasExplicitTheme(): boolean {
	try {
		const v = localStorage.getItem(THEME_KEY);
		return v === "dark" || v === "light";
	} catch {
		return false;
	}
}

/** 首屏前决定初始主题:显式记忆 > 系统偏好 */
export function initialDark(): boolean {
	try {
		const saved = localStorage.getItem(THEME_KEY);
		if (saved === "dark") return true;
		if (saved === "light") return false;
	} catch {
		/* localStorage 不可用 */
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ThemeState {
	dark: boolean;
	/** 应用到 DOM + 原生标题栏;persist=true 时写入 localStorage */
	apply: (dark: boolean, persist?: boolean) => void;
	toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
	dark: initialDark(),
	apply: (dark, persist = false) => {
		document.documentElement.classList.toggle("dark", dark);
		window.piApi.setNativeTheme(dark);
		if (persist) {
			try {
				localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
			} catch {
				/* 忽略 */
			}
		}
		set({ dark });
	},
	toggle: () => get().apply(!get().dark, true),
}));

// 用户没手动选过主题时,跟随系统切换(选了之后就不再抢用户的决定)
if (!hasExplicitTheme() && typeof window.matchMedia === "function") {
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
		if (!hasExplicitTheme()) useThemeStore.getState().apply(e.matches);
	});
}
