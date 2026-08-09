/**
 * 每个工作区的命令审批模式(localStorage 持久化):
 * - "full"  完全访问:危险命令自动放行
 * - "approve" 审批:危险命令弹框,用户手动批准/拒绝/本轮自动批准
 */
export type ApprovalMode = "full" | "approve";

const STORAGE_KEY = "pi-desktop-approval-mode";

type ModeMap = Record<string, ApprovalMode>;

export function loadApprovalModes(): ModeMap {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as ModeMap) : {};
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** 合并写入某个 workspace 的审批模式 */
export function saveApprovalMode(cwd: string, mode: ApprovalMode): void {
	if (!cwd) return;
	try {
		const modes = loadApprovalModes();
		modes[cwd] = mode;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
	} catch {
		/* localStorage 不可用时静默 */
	}
}
