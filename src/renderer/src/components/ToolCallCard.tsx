import { useState } from "react";
import { diffLines } from "diff";
import type { ToolCallView } from "../store/useSessionStore";

/** bash 风格深底等宽块(工具调用与 bashExecution 消息共用) */
export function BashBlock({
	command,
	output,
	exitCode,
	truncated,
	cancelled,
}: {
	command: string;
	output: string;
	exitCode?: number;
	truncated?: boolean;
	cancelled?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const lines = output.split("\n");
	const COLLAPSE_AT = 12;
	const collapsible = lines.length > COLLAPSE_AT;
	const shown = expanded ? output : lines.slice(0, COLLAPSE_AT).join("\n");

	return (
		<div className="rounded-lg overflow-hidden border border-sep my-1.5">
			<div className="bg-[#232326] text-[#e8e8e8] px-3 py-2 font-mono text-xs">
				<div className="flex items-start gap-2">
					<span className="text-green shrink-0">$</span>
					<span className="whitespace-pre-wrap break-all">{command}</span>
					{exitCode !== undefined && (
						<span
							className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
								exitCode === 0 ? "bg-green/20 text-green" : "bg-red/20 text-red"
							}`}
						>
							exit {exitCode}
						</span>
					)}
					{cancelled && <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-orange/20 text-orange">已取消</span>}
				</div>
				{output && (
					<pre className="mt-2 whitespace-pre-wrap break-all text-[#c8c8c8] max-h-80 overflow-y-auto">
						{shown}
						{collapsible && !expanded && `\n… 共 ${lines.length} 行`}
					</pre>
				)}
				{truncated && <div className="text-[10px] text-orange mt-1">输出已被 pi 截断</div>}
			</div>
			{collapsible && (
				<button
					onClick={() => setExpanded((v) => !v)}
					className="w-full text-xs text-txt2 hover:text-txt bg-side py-1"
				>
					{expanded ? "收起" : "展开全部"}
				</button>
			)}
		</div>
	);
}

/** 状态点颜色 */
function statusDot(call: ToolCallView): string {
	if (call.status === "running") return "bg-orange animate-pulse";
	if (call.status === "error") return "bg-red";
	return "bg-green";
}

/** 宽松提取路径类参数 */
function pickPath(args: Record<string, unknown>): string | undefined {
	for (const k of ["path", "filePath", "file", "file_path"]) {
		const v = args[k];
		if (typeof v === "string" && v) return v;
	}
	return undefined;
}

/** 宽松提取编辑前后文本 */
function pickEditTexts(args: Record<string, unknown>): { oldText: string; newText: string } | null {
	const oldText = args.oldText ?? args.old_text ?? args.oldString ?? args.old_string;
	const newText = args.newText ?? args.new_text ?? args.newString ?? args.new_string ?? args.content;
	if (typeof oldText === "string" && typeof newText === "string") return { oldText, newText };
	// write 类工具:全文作为新增
	if (typeof args.content === "string") return { oldText: "", newText: args.content };
	return null;
}

/** edit/write 的 diff 渲染(绿增红删) */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
	const parts = diffLines(oldText, newText);
	return (
		<pre className="font-mono text-xs rounded-lg border border-sep overflow-x-auto my-1.5 max-h-96 overflow-y-auto">
			{parts.map((p, i) => {
				const cls = p.added ? "bg-green/15 text-diff-add" : p.removed ? "bg-red/15 text-diff-del" : "text-txt2";
				const sign = p.added ? "+ " : p.removed ? "- " : "  ";
				return (
					<div key={i} className={`${cls} px-2 whitespace-pre-wrap break-all`}>
						{sign}
						{p.value.replace(/\n$/, "")}
					</div>
				);
			})}
		</pre>
	);
}

/** 工具调用卡片 */
export default function ToolCallCard({ call }: { call: ToolCallView }) {
	const [open, setOpen] = useState(false);
	const tool = call.toolName.toLowerCase();
	const isBash = tool === "bash" || tool === "shell";
	const isEdit = tool === "edit" || tool === "write" || tool === "multiedit" || tool === "str_replace_editor";
	const path = pickPath(call.args);
	const outputText = call.resultText ?? call.partialText ?? "";
	// 宽松提取 exitCode(可能在 result details 里)
	const details = call.resultDetails as { exitCode?: number } | undefined;
	const exitCode = typeof details?.exitCode === "number" ? details.exitCode : undefined;

	const borderCls = call.isError ? "border-red" : "border-sep";

	return (
		<div className={`my-1.5 rounded-xl border ${borderCls} bg-card overflow-hidden`}>
			<button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
				<span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(call)}`} />
				<span className="text-sm font-medium shrink-0">{call.toolName}</span>
				{path && <span className="text-xs text-txt2 truncate">{path}</span>}
				{isBash && typeof call.args.command === "string" && (
					<span className="text-xs text-txt2 truncate font-mono">{call.args.command}</span>
				)}
				<span className={`ml-auto text-txt2 text-xs transition-transform shrink-0 ${open ? "rotate-90" : ""}`}>▸</span>
			</button>

			{open && (
				<div className="px-3 pb-3">
					{isBash ? (
						<BashBlock
							command={String(call.args.command ?? "")}
							output={outputText}
							exitCode={exitCode}
						/>
					) : isEdit ? (
						(() => {
							const texts = pickEditTexts(call.args);
							if (texts) return <DiffView oldText={texts.oldText} newText={texts.newText} />;
							return (
								<pre className="font-mono text-xs bg-side rounded-lg p-2 overflow-x-auto">
									{JSON.stringify(call.args, null, 2)}
								</pre>
							);
						})()
					) : (
						<>
							<details className="my-1">
								<summary className="text-xs text-txt2 cursor-pointer">参数</summary>
								<pre className="font-mono text-xs bg-side rounded-lg p-2 overflow-x-auto mt-1 max-h-48 overflow-y-auto">
									{JSON.stringify(call.args, null, 2)}
								</pre>
							</details>
							{outputText && (
								<details className="my-1" open={call.isError}>
									<summary className={`text-xs cursor-pointer ${call.isError ? "text-red" : "text-txt2"}`}>
										结果({outputText.split("\n").length} 行)
									</summary>
									<pre className="font-mono text-xs bg-side rounded-lg p-2 overflow-x-auto mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
										{outputText}
									</pre>
								</details>
							)}
						</>
					)}
					{/* bash/edit 的附加文本结果 */}
					{(isBash || isEdit) && call.isError && outputText && !isBash && (
						<pre className="font-mono text-xs bg-red/10 text-red rounded-lg p-2 overflow-x-auto mt-1 whitespace-pre-wrap break-all">
							{outputText}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
