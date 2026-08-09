import { useState, type ReactNode } from "react";

/**
 * 自定义悬浮提示:鼠标移入显示、移出消失(不依赖原生 title,
 * 避免元素被替换/重渲染时 Chromium 的原生 tooltip 卡在屏幕上)。
 * pointer-events-none 保证气泡本身不干扰鼠标事件。
 */
export default function Tooltip({
	label,
	children,
	side = "bottom",
}: {
	label: string;
	children: ReactNode;
	side?: "top" | "bottom";
}) {
	const [show, setShow] = useState(false);
	const origin = side === "bottom" ? "top center" : "bottom center";
	return (
		<span
			className="relative inline-flex"
			onMouseEnter={() => setShow(true)}
			onMouseLeave={() => setShow(false)}
			onFocus={() => setShow(true)}
			onBlur={() => setShow(false)}
		>
			{children}
			{show && (
				<span
					role="tooltip"
					className={`animate-popover absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#232326] text-white/90 text-xs px-2 py-1 z-50 pointer-events-none shadow-lg ${
						side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
					}`}
					style={{ "--transform-origin": origin } as React.CSSProperties}
				>
					{label}
				</span>
			)}
		</span>
	);
}
