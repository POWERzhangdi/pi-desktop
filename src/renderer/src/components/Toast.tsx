import { useSessionStore, type ToastItem } from "../store/useSessionStore";

const kindClass: Record<ToastItem["kind"], string> = {
	info: "border-accent text-txt",
	warning: "border-orange text-txt",
	error: "border-red text-txt",
};

const dotClass: Record<ToastItem["kind"], string> = {
	info: "bg-accent",
	warning: "bg-orange",
	error: "bg-red",
};

/** 右上角 toast 栈;带 actionCwd 的可一键跳到对应 workspace */
export default function ToastStack() {
	const toasts = useSessionStore((s) => s.toasts);
	const dismiss = useSessionStore((s) => s.dismissToast);
	const setActive = useSessionStore((s) => s.setActive);

	return (
		<div className="fixed top-4 right-4 z-50 space-y-2 w-80">
			{toasts.map((t) => (
			<div
				key={t.id}
				onMouseEnter={() => dismiss(t.id)}
				className={`animate-toast bg-card border-l-4 ${kindClass[t.kind]} border border-sep rounded-lg shadow-lg px-3 py-2 text-sm flex items-start gap-2`}
			>
					<span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotClass[t.kind]}`} />
					<span className="flex-1 break-words">{t.message}</span>
					{t.actionCwd && (
						<button
							onClick={() => {
								void setActive(t.actionCwd!);
								dismiss(t.id);
							}}
							className="btn-press shrink-0 text-xs text-accent hover:underline mt-0.5 rounded"
						>
							前往
						</button>
					)}
					<button onClick={() => dismiss(t.id)} className="btn-press text-txt2 hover:text-txt shrink-0 w-5 h-5 flex items-center justify-center rounded">
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
					</button>
				</div>
			))}
		</div>
	);
}
