import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useActiveBackend, useActiveWs, useSessionStore } from "../store/useSessionStore";
import type { CommandInfo } from "../../../shared/rpc-types";
import type { FileEntry } from "../../../shared/ipc";
import { FileIcon } from "./FileIcon";

/** source 徽标配色 */
const sourceBadge: Record<CommandInfo["source"], string> = {
	extension: "bg-purple/15 text-purple",
	prompt: "bg-accent/15 text-accent",
	skill: "bg-green/15 text-green",
};

/** 审批模式开关(per-workspace):完全访问 / 审批 */
function ApprovalModeToggle() {
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const mode = useSessionStore((s) => s.approvalModeByCwd[activeCwd] ?? "full");
	const setApprovalMode = useSessionStore((s) => s.setApprovalMode);
	const next = mode === "full" ? "approve" : "full";
	return (
		<div className="mb-2">
			<button
				onClick={() => setApprovalMode(activeCwd, next)}
				title={
					mode === "full"
						? "完全访问:危险命令自动执行。点击切到审批模式"
						: "审批:危险命令需手动批准。点击切到完全访问"
				}
				className={`inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 text-[11px] transition-colors ${
					mode === "approve" ? "bg-orange/15 text-orange" : "bg-side text-txt2 hover:text-txt"
				}`}
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
				</svg>
				{mode === "full" ? "完全访问" : "审批"}
			</button>
		</div>
	);
}

/* ---------------- 附件(文件 / 图片)---------------- */

interface AttachImage {
	name: string;
	data: string; // base64(无 data: 前缀)
	mimeType: string;
}

const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

function isImageFile(file: File): boolean {
	if (file.type.startsWith("image/")) return true;
	const name = file.name.toLowerCase();
	return IMAGE_EXT.some((ext) => name.endsWith(ext));
}

/** Electron 的 File 对象带 path(绝对路径) */
function filePath(file: File): string {
	return (file as File & { path?: string }).path ?? file.name;
}

function dirname(p: string): string {
	const sep = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
	return sep >= 0 ? p.substring(0, sep) : p;
}

function readImageBase64(file: File): Promise<AttachImage> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const comma = result.indexOf(",");
			resolve({
				name: file.name,
				data: comma >= 0 ? result.slice(comma + 1) : result,
				mimeType: file.type || "image/png",
			});
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/** 底部输入区:Enter 发送 / Shift+Enter 换行;`/` 触发命令补全;"+" 附加文件/图片 */
export default function Composer() {
	const [text, setText] = useState("");
	const [selIndex, setSelIndex] = useState(0);
	const [images, setImages] = useState<AttachImage[]>([]);
	const [menuOpen, setMenuOpen] = useState(false);
	const [ocrLoading, setOcrLoading] = useState(false);
	const [fileResults, setFileResults] = useState<FileEntry[]>([]);
	const [fileSel, setFileSel] = useState(0);
	const [fileRefs, setFileRefs] = useState<FileEntry[]>([]);
	const ocrEngine = useSessionStore((s) => s.ocrEngine);
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);
	const imageInputRef = useRef<HTMLInputElement>(null);

	const isStreaming = useActiveWs((s) => s.isStreaming);
	const backendState = useActiveBackend().state;
	const slashCommands = useSessionStore((s) => s.slashCommands);
	const sendPrompt = useSessionStore((s) => s.sendPrompt);
	const abort = useSessionStore((s) => s.abort);

	// 仅当输入以 / 开头且不含空格时补全
	const completions = useMemo(() => {
		if (!text.startsWith("/") || text.includes(" ") || text.includes("\n")) return [];
		const prefix = text.slice(1).toLowerCase();
		return slashCommands.filter((c) => c.name.toLowerCase().startsWith(prefix)).slice(0, 8);
	}, [text, slashCommands]);

	const completionOpen = completions.length > 0;

	// @ 文件引用补全:句中 @ 前为空白/行首、@ 后无空格(避免邮箱误触);假设光标在末尾
	const fileQuery = useMemo(() => {
		const m = text.match(/(?:^|\s)@([^\s@]*)$/);
		return m ? m[1] : null;
	}, [text]);
	const fileCompletionOpen = fileQuery !== null && fileResults.length > 0;

	// @ 补全:debounce 调主进程扫描(带缓存)
	useEffect(() => {
		if (fileQuery === null || !activeCwd) {
			setFileResults([]);
			return;
		}
		let cancelled = false;
		const t = setTimeout(async () => {
			const r = await window.piApi.listFiles(activeCwd, fileQuery);
			if (!cancelled) {
				setFileResults(r);
				setFileSel(0);
			}
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [fileQuery, activeCwd]);

	// 工作区激活时后台预热文件缓存(@ 时即时命中)
	useEffect(() => {
		if (activeCwd) void window.piApi.filesWarm(activeCwd);
	}, [activeCwd]);

	const pickFile = (f: FileEntry) => {
		setFileRefs((prev) => [...prev, f]);
		setText((t) => t.replace(/(\s|^)@[^\s@]*$/, "$1"));
		setFileResults([]);
		setFileSel(0);
		textareaRef.current?.focus();
	};

	const removeFileRef = (i: number) => setFileRefs((prev) => prev.filter((_, idx) => idx !== i));

	const pickCompletion = (cmd: CommandInfo) => {
		setText(`/${cmd.name} `);
		setSelIndex(0);
		textareaRef.current?.focus();
	};

	/** 把路径追加到消息文本(新行) */
	const appendPaths = (paths: string[]) => {
		if (paths.length === 0) return;
		setText((t) => (t ? `${t}\n${paths.join("\n")}` : paths.join("\n")));
	};

	const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		e.target.value = ""; // 允许重复选同一文件
		const imgFiles = files.filter(isImageFile);
		const otherPaths = files.filter((f) => !isImageFile(f)).map(filePath);
		if (imgFiles.length > 0) {
			try {
				const imgs = await Promise.all(imgFiles.map(readImageBase64));
				setImages((prev) => [...prev, ...imgs]);
			} catch {
				/* 读取失败忽略 */
			}
		}
		appendPaths(otherPaths);
	};

	const onFolder = (e: ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		e.target.value = "";
		if (files && files.length > 0) appendPaths([dirname(filePath(files[0]))]);
	};

	/** 选择图片:全部按图片处理,转 base64 附加(多模态) */
	const onImages = async (e: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		e.target.value = "";
		if (files.length === 0) return;
		try {
			const imgs = await Promise.all(files.map(readImageBase64));
			setImages((prev) => [...prev, ...imgs]);
		} catch {
			/* 读取失败忽略 */
		}
	};

	/** PDF:主进程弹框选文件 + 加载 pi read_pdf 扩展解析,结果填入输入框(不走 LLM) */
	const onPdf = async () => {
		setOcrLoading(true);
		try {
			const text = await window.piApi.pdfExtract();
			if (text) setText((t) => (t ? `${t}\n${text}` : text));
		} finally {
			setOcrLoading(false);
		}
	};
	/** Excel:主进程弹框选文件 + 加载 pi read_excel 扩展解析,结果填入输入框(不走 LLM) */
	const onExcel = async () => {
		setOcrLoading(true);
		try {
			const text = await window.piApi.excelExtract();
			if (text) setText((t) => (t ? `${t}\n${text}` : text));
		} finally {
			setOcrLoading(false);
		}
	};

	/** OCR:主进程弹框选图 + 加载 pi ocr 扩展识别(当前引擎),结果填入输入框(不走 LLM) */
	const onOcr = async () => {
		setOcrLoading(true);
		try {
			const recognized = await window.piApi.ocrRecognize(ocrEngine);
			if (recognized) setText((t) => (t ? `${t}\n${recognized}` : recognized));
		} finally {
			setOcrLoading(false);
		}
	};

	const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

	// + 菜单外部点击关闭
	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	const send = () => {
		const t = text.trim();
		if (!t) return;
		const paths = fileRefs.map((f) => f.path);
		const full = paths.length > 0 ? `${t}\n${paths.join("\n")}` : t;
		const imgs =
			images.length > 0
				? images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }))
				: undefined;
		setText("");
		setImages([]);
		setFileRefs([]);
		setSelIndex(0);
		void sendPrompt(full, imgs);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (completionOpen) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelIndex((i) => (i + 1) % completions.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelIndex((i) => (i - 1 + completions.length) % completions.length);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				pickCompletion(completions[selIndex]);
				return;
			}
			if (e.key === "Escape") {
				// 清空触发补全的 /,关闭列表
				setText("");
				return;
			}
		}
		if (fileCompletionOpen) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setFileSel((i) => (i + 1) % fileResults.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setFileSel((i) => (i - 1 + fileResults.length) % fileResults.length);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				pickFile(fileResults[fileSel]);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setText((t) => t.replace(/@[^\s@]*$/, ""));
				return;
			}
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	};

	const disabled = backendState !== "ready";

	return (
		<div className="shrink-0 bg-ground px-6 py-4">
			<div className="max-w-[860px] mx-auto">
				<ApprovalModeToggle />
			</div>
			<div className="max-w-[860px] mx-auto relative">
				{/* 斜杠命令补全 */}
				{completionOpen && (
					<div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-sep rounded-xl shadow-lg overflow-hidden z-20">
						{completions.map((c, i) => (
							<button
								key={c.name}
								onMouseDown={(e) => {
									e.preventDefault();
									pickCompletion(c);
								}}
								className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${
									i === selIndex ? "bg-accent-soft" : "hover:bg-side"
								}`}
							>
								<span className="font-mono">/{c.name}</span>
								<span className={`text-[10px] rounded px-1.5 py-0.5 shrink-0 ${sourceBadge[c.source] ?? ""}`}>
									{c.source}
								</span>
								{c.description && <span className="text-xs text-txt2 truncate">{c.description}</span>}
							</button>
						))}
					</div>
				)}

				{/* @ 文件引用补全 */}
				{fileCompletionOpen && (
					<div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-sep rounded-xl shadow-lg overflow-hidden z-20 max-h-64 overflow-y-auto">
						{fileResults.map((f, i) => (
							<button
								key={f.path}
								onMouseDown={(e) => {
									e.preventDefault();
									pickFile(f);
								}}
								className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${
									i === fileSel ? "bg-accent-soft" : "hover:bg-side"
								}`}
							>
								<FileIcon name={f.name} isDir={f.isDir} size={14} />
								<span className="font-mono truncate">{f.name}{f.isDir ? "/" : ""}</span>
								{f.dir && <span className="text-xs text-txt2 truncate">{f.dir}</span>}
							</button>
						))}
					</div>
				)}

				{/* 输入卡片 */}
				<div className="bg-card border border-sep rounded-2xl shadow-md shadow-black/5 p-3">
					{/* 图片附件 chips */}
					{images.length > 0 && (
						<div className="flex flex-wrap gap-2 mb-2">
							{images.map((img, i) => (
								<div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border border-sep shrink-0">
									<img
										src={`data:${img.mimeType};base64,${img.data}`}
										alt={img.name}
										className="w-full h-full object-cover"
									/>
									<button
										onClick={() => removeImage(i)}
										title="移除"
										className="absolute top-0 right-0 w-4 h-4 bg-black/50 text-white btn-press flex items-center justify-center hover:bg-black/70"
									>
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
									</button>
								</div>
							))}
						</div>
					)}

					{/* @ 引用文件 chips */}
					{fileRefs.length > 0 && (
						<div className="flex flex-wrap gap-2 mb-2">
							{fileRefs.map((f, i) => (
								<div
									key={i}
									className="inline-flex items-center gap-1 h-7 rounded-lg border border-sep bg-side pl-2 pr-1 text-xs"
								>
									<FileIcon name={f.name} isDir={f.isDir} size={13} />
									<span className="font-mono truncate max-w-[180px]" title={f.path}>
										{f.name}
										{f.isDir ? "/" : ""}
									</span>
									<button
										onClick={() => removeFileRef(i)}
										title="移除"
										className="shrink-0 w-4 h-4 flex items-center justify-center text-txt2 hover:text-red btn-press"
									>
										<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
									</button>
								</div>
							))}
						</div>
					)}

					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							setSelIndex(0);
						}}
						onKeyDown={onKeyDown}
						rows={Math.min(12, Math.max(3, text.split("\n").length))}
						placeholder={
							disabled
								? "后端未就绪…"
								: isStreaming
									? "agent 运行中,发送将 steer 插话(Enter 发送 · Shift+Enter 换行)"
									: "给 pi 发送消息…(Enter 发送 · Shift+Enter 换行 · / 命令 · @ 引用文件)"
						}
						disabled={disabled}
						className="w-full bg-transparent resize-none outline-none text-sm leading-6 placeholder:text-txt2/60 max-h-64"
					/>

					{/* 工具栏:[+] 通用文件/文件夹 + 四能力快捷按钮 + 发送 */}
					<div className="flex items-center gap-1.5 mt-2 flex-wrap">
						{/* + 通用 */}
						<div ref={menuRef} className="relative shrink-0">
							<button
								onClick={() => setMenuOpen((v) => !v)}
								disabled={disabled}
								title="选择文件或文件夹"
								className="w-9 h-9 rounded-xl text-txt2 hover:text-accent hover:bg-side flex items-center justify-center btn-press disabled:opacity-40"
							>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
							</button>
							{menuOpen && (
								<div
									className="animate-popover absolute bottom-full left-0 mb-1 z-30 w-32 bg-card border border-sep rounded-xl shadow-lg overflow-hidden py-1"
									style={{ "--transform-origin": "bottom left" } as any}
								>
									<button
										onClick={() => {
											setMenuOpen(false);
											fileInputRef.current?.click();
										}}
										className="w-full text-left text-sm px-3 py-1.5 hover:bg-side"
									>
										选择文件…
									</button>
									<button
										onClick={() => {
											setMenuOpen(false);
											folderInputRef.current?.click();
										}}
										className="w-full text-left text-sm px-3 py-1.5 hover:bg-side"
									>
										选择文件夹…
									</button>
								</div>
							)}
						</div>

						<div className="w-px h-5 bg-sep mx-0.5" />

						<button
							onClick={() => void onPdf()}
							disabled={disabled || ocrLoading}
							title={ocrLoading ? "处理中…" : "选择 PDF · 用 read_pdf 解析成文本(结果填入输入框)"}
							className="btn-press inline-flex items-center gap-1 h-9 px-2.5 rounded-xl text-txt2 hover:text-accent hover:bg-side text-xs disabled:opacity-40"
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
							PDF
						</button>
						<button
							onClick={() => void onExcel()}
							disabled={disabled || ocrLoading}
							title={ocrLoading ? "处理中…" : "选择 Excel/CSV · 用 read_excel 解析成表格(结果填入输入框)"}
							className="btn-press inline-flex items-center gap-1 h-9 px-2.5 rounded-xl text-txt2 hover:text-accent hover:bg-side text-xs disabled:opacity-40"
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
							Excel
						</button>
						<button
							onClick={() => void onOcr()}
							disabled={disabled || ocrLoading}
							title={ocrLoading ? "处理中…" : `选择图片 · OCR(${ocrEngine === "rapidocr" ? "RapidOCR 强" : "tesseract"})· 结果填入输入框 · 引擎在右上角⚙设置`}
							className="btn-press inline-flex items-center gap-1 h-9 px-2.5 rounded-xl text-txt2 hover:text-accent hover:bg-side text-xs disabled:opacity-40"
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="6" /><line x1="20" y1="20" x2="15.5" y2="15.5" /><path d="M7 13l3-5 3 5" /></svg>
							{ocrLoading ? "识别中…" : "OCR"}
						</button>
						<button
							onClick={() => imageInputRef.current?.click()}
							disabled={disabled}
							title="选择图片 · 作为附件让多模态模型直接看"
							className="btn-press inline-flex items-center gap-1 h-9 px-2.5 rounded-xl text-txt2 hover:text-accent hover:bg-side text-xs disabled:opacity-40"
						>
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
							图片
						</button>

						<div className="flex-1" />

						{isStreaming ? (
							<button
								onClick={() => void abort()}
								title="中止当前运行"
								className="btn-press shrink-0 w-9 h-9 rounded-xl bg-red text-white flex items-center justify-center hover:opacity-90"
							>
								<span className="w-3 h-3 bg-white rounded-[2px]" />
							</button>
						) : (
							<button
								onClick={send}
								disabled={disabled || !text.trim()}
								title="发送"
								className="btn-press shrink-0 w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40"
							>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
							</button>
						)}
					</div>
				</div>

				<input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e)} />
				<input
					ref={folderInputRef}
					type="file"
					className="hidden"
					{...({ webkitdirectory: "" } as Record<string, string>)}
					onChange={onFolder}
				/>
				<input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onImages(e)} />
			</div>
		</div>
	);
}
