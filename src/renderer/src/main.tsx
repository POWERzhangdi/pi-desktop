import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { readZoom } from "./store/zoom";

// 主题初始化:localStorage > prefers-color-scheme,默认浅色
const saved = localStorage.getItem("pi-desktop-theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isDark = saved === "dark" || (!saved && prefersDark);
if (isDark) {
	document.documentElement.classList.add("dark");
}
// 同步系统原生标题栏/边框主题(暗色下避免顶部发白)
window.piApi.setNativeTheme(isDark);

// 缩放初始化:首屏前应用,避免闪烁(只应用不持久化,默认值变更不会被旧记忆卡住)
window.piApi.setZoomFactor(readZoom());

createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
