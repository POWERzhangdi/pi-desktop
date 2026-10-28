import { useThemeStore } from "../store/theme";

/** 深浅色切换:html.dark + localStorage 持久化 + 系统原生标题栏同步(状态在 store 里,菜单也能切) */
export default function ThemeToggle() {
	const dark = useThemeStore((s) => s.dark);
	const toggle = useThemeStore((s) => s.toggle);

	return (
		<button
			onClick={toggle}
			title={dark ? "切换到浅色(Ctrl+Shift+L)" : "切换到深色(Ctrl+Shift+L)"}
			aria-label={dark ? "切换到浅色主题" : "切换到深色主题"}
			className="btn-press shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-txt2 hover:text-accent hover:bg-side"
		>
			{dark ? (
				/* 太阳:当前深色,点击切浅色 */
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
				</svg>
			) : (
				/* 月亮:当前浅色,点击切深色 */
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
				</svg>
			)}
		</button>
	);
}
