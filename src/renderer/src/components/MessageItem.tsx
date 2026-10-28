import { memo, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useSessionStore, type MessageView } from "../store/useSessionStore";
import ToolCallCard, { BashBlock } from "./ToolCallCard";

const REMARK_PLUGINS = [remarkGfm];
type MarkdownProps = ComponentProps<typeof ReactMarkdown>;
const REHYPE_PLUGINS: NonNullable<MarkdownProps["rehypePlugins"]> = [
	[rehypeHighlight, { ignoreMissing: true }],
];

/** 代码块:右上角"复制"(hover / 键盘聚焦时出现) */
function CodeBlock({ children }: { children?: ReactNode }) {
	const ref = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);
	const copy = () => {
		const text = ref.current?.innerText ?? "";
		if (!text) return;
		void navigator.clipboard.writeText(text).then(
			() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1200);
			},
			() => {},
		);
	};
	return (
		<div className="group/code relative">
			<pre ref={ref}>{children}</pre>
			<button
				onClick={copy}
				aria-label="复制代码"
				title="复制代码"
				className="btn-press absolute right-2 top-2 z-10 h-6 px-2 rounded-md bg-white/10 text-[11px] text-[#e8e8e8] opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-white/20"
			>
				{copied ? "已复制" : "复制"}
			</button>
		</div>
	);
}

/** 链接组件放在模块作用域:保持引用稳定,避免每次渲染重建导致 markdown 重解析 */
const MD_COMPONENTS: Components = {
	a: ({ href, children }) => (
		<a
			href={href}
			title={href}
			onClick={(e) => {
				// 渲染进程内导航会把 preload 的 window.piApi 交给不可信页面,一律外抛
				e.preventDefault();
				if (href) void window.piApi.openExternal(href);
			}}
		>
			{children}
		</a>
	),
	pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

/** Markdown 渲染(GFM + 代码高亮);text 不变则复用解析结果 */
export function Markdown({ text }: { text: string }) {
	const body = useMemo(
		() => (
			<ReactMarkdown
				remarkPlugins={REMARK_PLUGINS}
				rehypePlugins={REHYPE_PLUGINS}
				components={MD_COMPONENTS}
			>
				{text}
			</ReactMarkdown>
		),
		[text],
	);
	return <div className="md-body">{body}</div>;
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

/** 消息级操作(悬停出现):复制全文 */
function CopyMessageButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			onClick={() => {
				void navigator.clipboard.writeText(text).then(
					() => {
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1200);
					},
					() => {},
				);
			}}
			title="复制这条回复"
			aria-label="复制这条回复"
			className="btn-press h-6 px-2 rounded-md border border-sep bg-card text-[11px] text-txt2 hover:text-txt hover:bg-side"
		>
			{copied ? "已复制" : "复制"}
		</button>
	);
}

/** 单条消息 */
function MessageItemImpl({ msg }: { msg: MessageView }) {
	const retryLast = useSessionStore((s) => s.retryLast);
	const [copiedErr, setCopiedErr] = useState(false);
	// 完整正文(供复制);user/custom 用纯文本,assistant 拼接所有 text 块
	const plainText = useMemo(() => {
		if (msg.role === "assistant") {
			return msg.blocks
				.filter((b): b is { kind: "text"; text: string } => b.kind === "text")
				.map((b) => b.text)
				.join("\n\n")
				.trim();
		}
		return (msg.text ?? "").trim();
	}, [msg]);

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
		<div className="group/msg relative my-4">
			{plainText && (
				<div className="absolute -top-3 right-0 z-10 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity">
					<CopyMessageButton text={plainText} />
				</div>
			)}
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
				<div className="mt-2 text-sm text-danger bg-red/10 border border-red/40 rounded-lg px-3 py-2">
					<div className="whitespace-pre-wrap break-words">{msg.errorMessage}</div>
					<div className="mt-2 flex items-center gap-2">
						<button
							onClick={() => {
								void navigator.clipboard.writeText(msg.errorMessage ?? "").then(
									() => {
										setCopiedErr(true);
										window.setTimeout(() => setCopiedErr(false), 1200);
									},
									() => {},
								);
							}}
							className="btn-press text-xs border border-red/40 rounded-md px-2 py-0.5 hover:bg-red/10"
						>
							{copiedErr ? "已复制" : "复制错误"}
						</button>
						<button
							onClick={() => void retryLast()}
							title="把上一条用户消息再发一遍(pi 无回退语义)"
							className="btn-press text-xs border border-red/40 rounded-md px-2 py-0.5 hover:bg-red/10"
						>
							重发上一条
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** 消息对象在流式时只有最后一条会变,其余引用稳定 —— memo 可避免历史消息重解析/重渲染 */
export default memo(MessageItemImpl);
