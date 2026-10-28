import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { PROD_CSP } from "./src/shared/csp";

/**
 * 生产构建时把严格 CSP 注入 index.html。
 * 开发态不注入(整页刷新/HMR 需要放行内联脚本),由主进程的响应头给宽松策略。
 */
function cspMetaPlugin(): Plugin {
	return {
		name: "pi-desktop-csp-meta",
		transformIndexHtml: {
			order: "pre",
			handler(html, ctx) {
				if (ctx.server) return html;
				return {
					html,
					tags: [
						{
							tag: "meta",
							attrs: { "http-equiv": "Content-Security-Policy", content: PROD_CSP },
							injectTo: "head-prepend" as const,
						},
					],
				};
			},
		},
	};
}

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				// 沙箱化 preload 不支持 ESM:输出 CJS(.cjs 后缀确保不被 type:module 误判)
				output: { format: "cjs", entryFileNames: "[name].cjs" },
			},
		},
	},
	renderer: {
		plugins: [react(), tailwindcss(), cspMetaPlugin()],
		server: {
			watch: {
				// 编辑器/工具原子写留下的临时目录不要进 watcher(Windows 上会 EBUSY 崩掉 dev server)
				ignored: ["**/*.tmpdir/**", "**/.tmpdir/**", "**/*.tmp"],
			},
		},
		build: {
			rollupOptions: {
				output: {
					// 把 Markdown 解析链与 React 拆成独立 chunk:首屏更小、依赖缓存更稳
					manualChunks(id: string) {
						if (!id.includes("node_modules")) return undefined;
						if (id.includes("react-dom") || id.includes("/react/")) return "react";
						if (/react-markdown|remark-|rehype-|micromark|mdast|hast|unist|highlight\.js|lowlight|unified|vfile/.test(id)) {
							return "markdown";
						}
						return undefined;
					},
				},
			},
		},
	},
});
