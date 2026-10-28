/**
 * 表单/状态类 UI 原子。
 *
 * 模型管理页与 MCP 面板之前各写了一份 inputCls / labelCls / Spinner,
 * 改一处样式要改两个文件,而且两份已经出现细微差异。统一到这里。
 */
import type { ReactNode } from "react";
import type { ProviderTestResult } from "../../../shared/ipc";

export const inputCls =
	"w-full bg-ground border border-sep rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition placeholder:text-txt2/60";
export const labelCls = "block text-xs text-txt2 mb-1";

export const btnPrimary =
	"btn-press h-8 rounded-lg px-3 text-xs bg-accent text-white hover:bg-accent/90 disabled:opacity-40 inline-flex items-center gap-1.5";
export const btnGhost =
	"btn-press h-8 rounded-lg px-3 text-xs border border-sep text-txt2 hover:text-txt hover:bg-side disabled:opacity-40 inline-flex items-center gap-1.5";
export const btnDanger =
	"btn-press h-8 rounded-lg px-3 text-xs text-red hover:bg-red/10 disabled:opacity-40 inline-flex items-center gap-1.5";

export function Spinner() {
	return (
		<svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
			<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
			<path d="M12 2a10 10 0 0 0-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		</svg>
	);
}

export function SectionLabel({ children }: { children: ReactNode }) {
	return <h3 className="text-xs font-semibold text-txt2">{children}</h3>;
}

/** 测试连接结果块(淡入) */
export function TestResultBlock({
	result,
	okSuffix,
}: {
	result: ProviderTestResult;
	okSuffix?: string;
}) {
	return (
		<div
			className={`animate-list text-xs rounded-lg px-3 py-2 ${
				result.ok ? "bg-green/10 text-green" : "bg-red/10 text-red break-all whitespace-pre-wrap"
			}`}
		>
			{result.ok
				? `✓ 连接成功(${result.latencyMs ?? "?"}ms)${okSuffix ? ` · ${okSuffix}` : ""}`
				: `✗ ${result.error ?? "连接失败"}`}
		</div>
	);
}
