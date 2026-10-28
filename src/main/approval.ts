/**
 * 命令审批策略(主进程持有)。
 *
 * 为什么放在主进程:审批是安全边界,渲染进程只负责"展示与收集用户选择",
 * 不能自己决定放行。策略在这里判断,渲染进程即使被绕过也无从"自动批准"。
 *
 * 模式:
 * - approve(默认):危险命令一律弹框,用户逐条确认(或选择本轮自动批准)
 * - full:完全访问,危险命令自动放行
 *
 * 持久化:~/.pi-desktop/approval.json。autoTurn 是内存态,agent_start 时清空。
 */
import { join } from "node:path";
import { homedir } from "node:os";
import type { ApprovalMode } from "../shared/ipc";
import { readJsonFile, writeJsonAtomic } from "./util/json-file";

interface ApprovalFile {
	modes?: Record<string, ApprovalMode>;
}

/** 未知值一律视为默认(approve),避免配置被改成任意字符串后行为不确定 */
function normalize(mode: unknown): ApprovalMode | undefined {
	return mode === "full" || mode === "approve" ? mode : undefined;
}

export class ApprovalPolicy {
	private modes: Record<string, ApprovalMode> = {};
	/** 本轮已"自动批准"的工作区(内存态) */
	private autoTurn = new Set<string>();

	/** filePath 可注入,便于测试(默认 ~/.pi-desktop/approval.json) */
	constructor(private readonly filePath: string = join(homedir(), ".pi-desktop", "approval.json")) {
		const file = readJsonFile<ApprovalFile>(this.filePath, {});
		for (const [cwd, raw] of Object.entries(file.modes ?? {})) {
			const mode = normalize(raw);
			if (cwd && mode) this.modes[cwd] = mode;
		}
	}

	/** 当前模式(未设置 = approve,安全默认) */
	mode(cwd: string): ApprovalMode {
		return this.modes[cwd] ?? "approve";
	}

	allModes(): Record<string, ApprovalMode> {
		return { ...this.modes };
	}

	setMode(cwd: string, mode: ApprovalMode): void {
		if (!cwd) return;
		const next = normalize(mode);
		if (!next) throw new Error(`未知的审批模式: ${String(mode)}`);
		this.modes[cwd] = next;
		this.persist();
	}

	/** agent_start:新一轮开始,清掉上一轮的"自动批准" */
	beginTurn(cwd: string): void {
		this.autoTurn.delete(cwd);
	}

	setAutoTurn(cwd: string, on: boolean): void {
		if (on) this.autoTurn.add(cwd);
		else this.autoTurn.delete(cwd);
	}

	/** 是否应自动放行本次审批请求 */
	shouldAutoApprove(cwd: string): boolean {
		return this.mode(cwd) === "full" || this.autoTurn.has(cwd);
	}

	private persist(): void {
		try {
			writeJsonAtomic(this.filePath, { modes: this.modes });
		} catch (err) {
			console.error("[approval] 写入审批配置失败:", err);
		}
	}
}
