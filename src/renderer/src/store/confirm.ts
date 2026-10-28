/**
 * 应用内确认弹窗(替代 window.confirm)。
 *
 * window.confirm 是原生阻塞对话框:样式不可控、和暗色主题割裂、也无法加"危险操作"的红色语义。
 * 这里用一个极小的 store 把 Promise 化的确认请求接到 <ConfirmDialog/> 上:
 *
 *   if (!(await confirmAction({ title: "删除会话?", danger: true }))) return;
 */
import { create } from "zustand";

export interface ConfirmOptions {
	title: string;
	message?: string;
	confirmText?: string;
	cancelText?: string;
	/** 危险操作:确认按钮用红色,且默认焦点落在"取消"上 */
	danger?: boolean;
}

interface ConfirmState {
	open: boolean;
	options: ConfirmOptions | null;
	resolve: ((ok: boolean) => void) | null;
	request: (options: ConfirmOptions) => Promise<boolean>;
	settle: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
	open: false,
	options: null,
	resolve: null,
	request: (options) => {
		// 连续触发时先把上一个按"取消"结算,避免 Promise 永远悬挂
		get().resolve?.(false);
		return new Promise<boolean>((resolve) => {
			set({ open: true, options, resolve });
		});
	},
	settle: (ok) => {
		const resolve = get().resolve;
		set({ open: false, options: null, resolve: null });
		resolve?.(ok);
	},
}));

/** 弹出确认框,返回用户是否确认 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
	return useConfirmStore.getState().request(options);
}
