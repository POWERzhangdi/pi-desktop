/**
 * 全局确认弹窗:渲染 useConfirmStore 的当前请求。
 * 危险操作默认焦点在"取消",Esc / 点遮罩 / 取消 都返回 false。
 */
import { useConfirmStore } from "../store/confirm";
import Modal from "./Modal";

export default function ConfirmDialog() {
	const open = useConfirmStore((s) => s.open);
	const options = useConfirmStore((s) => s.options);
	const settle = useConfirmStore((s) => s.settle);

	if (!open || !options) return null;
	const danger = !!options.danger;

	return (
		<Modal open onClose={() => settle(false)} labelledBy="confirm-title" className="w-[440px] p-5">
			<h3 id="confirm-title" className="text-base font-semibold mb-2">
				{options.title}
			</h3>
			{options.message && (
				<p className="text-sm text-txt2 whitespace-pre-wrap leading-relaxed mb-5">{options.message}</p>
			)}
			<div className="flex justify-end gap-2">
				<button
					{...(danger ? { "data-autofocus": true } : {})}
					onClick={() => settle(false)}
					className="text-sm border border-sep rounded-lg px-4 py-1.5 text-txt2 hover:text-txt hover:bg-side btn-press"
				>
					{options.cancelText ?? "取消"}
				</button>
				<button
					{...(danger ? {} : { "data-autofocus": true })}
					onClick={() => settle(true)}
					className={`text-sm rounded-lg px-4 py-1.5 text-white btn-press hover:opacity-90 ${
						danger ? "bg-red" : "bg-accent"
					}`}
				>
					{options.confirmText ?? "确定"}
				</button>
			</div>
		</Modal>
	);
}
