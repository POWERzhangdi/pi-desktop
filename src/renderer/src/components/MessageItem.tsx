import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { MessageView } from "../store/useSessionStore";
import ToolCallCard, { BashBlock } from "./ToolCallCard";

/** Markdown 渲染(GFM + 代码高亮) */
export function Markdown({ text }: { text: string }) {
	return (
		<div className="md-body">
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
				{text}
			</ReactMarkdown>
		</div>
	);
}

/** thinking 块:灰色折叠 */
function ThinkingBlock({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="my-1.5">
			<button
				onClick={() => setOpen((v) => !v)}
				className="text-xs text-txt2 hover:text-txt flex items-center gap-1"
			>
				<span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
				思考过程
			</button>
			{open && (
				<div className="mt-1 text-xs text-txt2 bg-side rounded-lg px-3 py-2 whitespace-pre-wrap max-h-64 overflow-y-auto">
					{text}
				</div>
			)}
		</div>
	);
}

/** 单条消息 */
export default function MessageItem({ msg }: { msg: MessageView }) {
	// 用户消息:右侧气泡
	if (msg.role === "user") {
		return (
			<div className="flex justify-end my-3">
				<div className="bg-bubble text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[75%] whitespace-pre-wrap break-words">
					{msg.text}
				</div>
			</div>
		);
	}

	// 系统提示(压缩摘要等):居中细分隔
	if (msg.role === "system") {
		return (
			<div className="my-4 text-center">
				<span className="text-xs text-txt2 bg-side rounded-full px-3 py-1 inline-block max-w-full truncate" title={msg.text}>
					{msg.text}
				</span>
			</div>
		);
	}

	// bash 执行(!命令)
	if (msg.role === "bashExecution" && msg.bash) {
		return (
			<div className="my-3">
				<BashBlock
					command={msg.bash.command}
					output={msg.bash.output}
					exitCode={msg.bash.exitCode}
					truncated={msg.bash.truncated}
					cancelled={msg.bash.cancelled}
				/>
			</div>
		);
	}

	// 扩展注入的自定义消息
	if (msg.role === "custom") {
		return (
			<div className="my-3 border border-sep rounded-xl px-4 py-2.5 bg-side">
				<Markdown text={msg.text ?? ""} />
			</div>
		);
	}

	// assistant:左侧 Markdown 流
	return (
		<div className="my-4">
			{msg.blocks.map((block, i) => {
				if (block.kind === "text") {
					return block.text.trim() ? <Markdown key={i} text={block.text} /> : null;
				}
				if (block.kind === "thinking") {
					return <ThinkingBlock key={i} text={block.text} />;
				}
				const call = msg.toolCalls.find((c) => c.toolCallId === block.toolCallId);
				return call ? <ToolCallCard key={i} call={call} /> : null;
			})}
			{msg.errorMessage && (
				<div className="mt-2 text-sm text-red bg-red/10 border border-red/40 rounded-lg px-3 py-2">
					{msg.errorMessage}
				</div>
			)}
		</div>
	);
}
