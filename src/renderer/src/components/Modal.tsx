/**
 * 通用模态框:遮罩 + Esc 关闭 + 焦点陷阱 + 初始焦点 + 关闭后焦点归位。
 *
 * 之前三个覆盖层(设置 / MCP / 审批)各写一套:有的 Esc 能关、有的不能,
 * 点击遮罩行为也不一致,而且都没有焦点管理(打开后 activeElement 仍是 body)。
 * 统一到这里,调用方只关心内容。
 *
 * 初始焦点:优先 `[data-autofocus]`,否则容器内第一个可聚焦元素。
 * 遮罩关闭用 mousedown 且要求 target 是遮罩本身,避免在弹窗内拖选文本时误关。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
	'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusable(panel: HTMLElement | null): HTMLElement[] {
	if (!panel) return [];
	return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => el.offsetParent !== null || el === document.activeElement,
	);
}

export default function Modal({
	open,
	onClose,
	children,
	className = "",
	labelledBy,
	closeOnBackdrop = true,
	closeOnEsc = true,
	role = "dialog",
}: {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	className?: string;
	labelledBy?: string;
	closeOnBackdrop?: boolean;
	closeOnEsc?: boolean;
	role?: "dialog" | "alertdialog";
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	// 回调放 ref:调用方通常传内联箭头函数,若进 deps 会导致 effect 每次渲染重跑、焦点被反复抢走
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const escRef = useRef(closeOnEsc);
	escRef.current = closeOnEsc;

	useEffect(() => {
		if (!open) return;
		const prev = document.activeElement as HTMLElement | null;
		const panel = panelRef.current;
		const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? focusable(panel)[0];
		// 等一帧:让 @starting-style 入场动画与 autoFocus 冲突时以我们为准
		const raf = requestAnimationFrame(() => target?.focus());

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && escRef.current) {
				e.preventDefault();
				e.stopPropagation();
				onCloseRef.current();
				return;
			}
			if (e.key !== "Tab") return;
			const nodes = focusable(panel);
			if (nodes.length === 0) {
				e.preventDefault();
				return;
			}
			const first = nodes[0]!;
			const last = nodes[nodes.length - 1]!;
			const active = document.activeElement;
			const inside = !!panel && !!active && panel.contains(active);
			if (e.shiftKey && (active === first || !inside)) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && (active === last || !inside)) {
				e.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener("keydown", onKey, true);
			// 关闭后把焦点还给触发者(若它还在文档里)
			if (prev && document.contains(prev)) prev.focus();
		};
	}, [open]);

	if (!open) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
			onMouseDown={(e) => {
				if (closeOnBackdrop && e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={panelRef}
				role={role}
				aria-modal="true"
				aria-labelledby={labelledBy}
				className={`animate-modal bg-card border border-sep rounded-2xl shadow-xl ${className}`}
			>
				{children}
			</div>
		</div>,
		document.body,
	);
}
