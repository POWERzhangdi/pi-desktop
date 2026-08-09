/**
 * pi 扩展:危险 bash 命令审批门。
 *
 * 机制:监听 tool_call 事件(工具执行前触发,可 block)。命中危险正则时,
 * 调 ctx.ui.confirm("命令审批", cmd) 请求用户确认。RPC 模式下该请求路由到
 * pi-desktop 客户端的 ExtensionUiDialog;用户拒绝则 block,批准则放行。
 *
 * 客户端侧按工作区模式决定:完全访问 -> 自动放行;审批 -> 弹框/本轮自动批准。
 *
 * 危险正则:默认覆盖常见破坏性命令;可用 ~/.pi-desktop/dangerous.txt 覆盖
 * (每行一个正则,# 开头注释;读取失败回退默认)。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_PATTERNS: RegExp[] = [
	/rm\s+-rf/i,
	/\bsudo\b/i,
	/\bmkfs\b/i,
	/:\(\)\s*\{/, // fork bomb
	/drop\s+table/i,
	/truncate\s+table/i,
	/>\s*\/dev\/sd/i,
	/\bdd\s+if=/i,
	/chmod\s+-R/i,
	/chown\s+-R/i,
];

function loadPatterns(): RegExp[] {
	try {
		const home = process.env.USERPROFILE || process.env.HOME || "";
		const file = join(home, ".pi-desktop", "dangerous.txt");
		if (existsSync(file)) {
			const lines = readFileSync(file, "utf8")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l && !l.startsWith("#"));
			if (lines.length > 0) return lines.map((l) => new RegExp(l));
		}
	} catch {
		/* 读取失败回退默认 */
	}
	return DEFAULT_PATTERNS;
}

const PATTERNS = loadPatterns();

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const cmd = (event.input as { command?: string } | undefined)?.command ?? "";
		if (!cmd || !PATTERNS.some((re) => re.test(cmd))) return;
		// 无 UI(非交互模式)时不拦,避免 hang
		if (!ctx.hasUI) return;
		const ok = await ctx.ui.confirm("命令审批", cmd);
		if (!ok) return { block: true, reason: "用户拒绝执行" };
	});
}
