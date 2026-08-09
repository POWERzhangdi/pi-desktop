import { useEffect, useRef } from "react";
import { useActiveWs } from "../store/useSessionStore";
import MessageItem from "./MessageItem";

/** 消息流:自动滚到底(数据来自当前 workspace 桶) */
export default function MessageList() {
	const messages = useActiveWs((s) => s.messages);
	const isStreaming = useActiveWs((s) => s.isStreaming);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages, isStreaming]);

	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto">
			<div className="max-w-[860px] mx-auto px-6 py-6">
				{messages.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center text-txt2 pt-32">
						<span className="text-4xl font-bold text-accent mb-3">pi</span>
						<p className="text-sm">在下方输入框开始新的对话</p>
					</div>
				) : (
					messages.map((m) => <MessageItem key={m.id} msg={m} />)
				)}
				{isStreaming && (
					<div className="flex items-center gap-1.5 text-txt2 py-3">
						<span className="pi-dot w-1.5 h-1.5 rounded-full bg-accent" />
						<span className="pi-dot w-1.5 h-1.5 rounded-full bg-accent" />
						<span className="pi-dot w-1.5 h-1.5 rounded-full bg-accent" />
					</div>
				)}
			</div>
		</div>
	);
}
