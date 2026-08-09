/**
 * 运行环境与 OCR 设置面板(居中 Modal)。
 * - 运行环境:检测并展示 pi / Node / Python 的路径与版本(未检测到则提示)
 * - 运行时来源:env=环境变量 / config=自定义 / detected=全局检测 / bundled=内置兜底 / missing=缺失
 * - OCR 引擎:tesseract(默认,纯 JS) / RapidOCR(强,需 Python+包);RapidOCR 未就绪时傻瓜式引导安装
 * Python 缺失给 winget 安装指引;rapidocr 未装提供"一键安装"按钮,点击弹出终端风格进度弹窗(逐行日志 + 闪烁光标)。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSessionStore } from "../store/useSessionStore";
import type { EnvInfo, PiConfig, RuntimeSource } from "../../../shared/ipc";
import McpManagerPanel from "./McpManagerPanel";

const SOURCE_LABEL: Record<RuntimeSource, string> = {
	env: "环境变量",
	config: "自定义",
	detected: "全局检测",
	bundled: "内置",
	missing: "缺失",
};

const SOURCE_CLASS: Record<RuntimeSource, string> = {
	env: "text-orange bg-orange/10",
	config: "text-orange bg-orange/10",
	detected: "text-green bg-green/10",
	bundled: "text-accent bg-accent-soft",
	missing: "text-red bg-red/10",
};

/** 环境项行:徽章 + 名称 + 来源徽章 + 就绪状态 + 路径(可编辑) + 版本 */
function EnvRow({
	badge,
	name,
	ok,
	path,
	version,
	source,
	onSave,
	onReset,
}: {
	badge: string;
	name: string;
	ok: boolean;
	path: string;
	version?: string | null;
	source?: RuntimeSource;
	onSave?: (p: string) => void;
	/** 清空手动配置,回到自动检测/内置兜底链 */
	onReset?: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [val, setVal] = useState(path);
	useEffect(() => setVal(path), [path]);
	const commit = () => {
		setEditing(false);
		const v = val.trim();
		if (onSave && v && v !== path) onSave(v);
	};
	return (
		<div className="flex items-center gap-3 py-2.5">
			<div className="shrink-0 w-7 h-7 rounded-lg bg-side flex items-center justify-center text-[11px] font-mono text-txt2">
				{badge}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">{name}</span>
					{source && (
						<span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_CLASS[source]}`}>
							{SOURCE_LABEL[source]}
						</span>
					)}
					{ok ? (
						<span className="text-[10px] text-green">✓ 就绪</span>
					) : (
						<span className="text-[10px] text-orange">未检测到</span>
					)}
					{onSave && !editing && (
						<button
							onClick={() => {
								setVal(path);
								setEditing(true);
							}}
							className="text-[10px] text-txt2 hover:text-accent btn-press hover:bg-side rounded px-1.5 py-0.5"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
						</button>
					)}
					{onReset && (source === "config" || source === "env") && (
						<button
							onClick={onReset}
							title="清空手动配置,恢复自动检测/内置兜底"
							className="text-[10px] text-txt2 hover:text-accent btn-press hover:bg-side rounded px-1.5 py-0.5"
						>
							恢复自动
						</button>
					)}
				</div>
				{editing ? (
					<input
						value={val}
						onChange={(e) => setVal(e.target.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === "Enter") commit();
							if (e.key === "Escape") {
								setEditing(false);
								setVal(path);
							}
						}}
						autoFocus
						className="w-full text-xs font-mono bg-ground border border-accent rounded px-1.5 py-0.5 outline-none"
					/>
				) : (
					<div className="text-xs text-txt2 truncate font-mono" title={path}>
						{path || "-"}
					</div>
				)}
			</div>
			{version && <span className="shrink-0 text-[11px] text-txt2/70 tabular-nums">{version}</span>}
		</div>
	);
}

export default function EnvSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [env, setEnv] = useState<EnvInfo | null>(() => {
		try {
			const s = localStorage.getItem("pi-desktop-env");
			return s ? (JSON.parse(s) as EnvInfo) : null;
		} catch {
			return null;
		}
	});
	const [envTs, setEnvTs] = useState<number | null>(() => Number(localStorage.getItem("pi-desktop-env-ts")) || null);
	const [runtime, setRuntime] = useState<PiConfig["runtimeInfo"] | null>(null);
	const [loading, setLoading] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [installLog, setInstallLog] = useState<string[]>([]);
	const [installOpen, setInstallOpen] = useState(false);
	const [installDone, setInstallDone] = useState<"ok" | "error" | null>(null);
	const [tab, setTab] = useState<"env" | "ocr" | "mcp">("env");
	const termRef = useRef<HTMLDivElement>(null);

	const ocrEngine = useSessionStore((s) => s.ocrEngine);
	const setOcrEngine = useSessionStore((s) => s.setOcrEngine);
	const pushToast = useSessionStore((s) => s.pushToast);
	const isMac = window.piApi.platform === "darwin";

	const refresh = async () => {
		setLoading(true);
		try {
			const e = await window.piApi.envCheck();
			setEnv(e);
			const ts = Date.now();
			setEnvTs(ts);
			localStorage.setItem("pi-desktop-env", JSON.stringify(e));
			localStorage.setItem("pi-desktop-env-ts", String(ts));
			// 运行时来源(env/config/detected/bundled/missing)每次刷新取最新
			const cfg = await window.piApi.getConfig();
			setRuntime(cfg.runtimeInfo ?? null);
		} finally {
			setLoading(false);
		}
	};

	// 打开时:有记住的结果就不重复检测,无则检测一次;运行时来源同步拉一次
	useEffect(() => {
		if (open && !env) void refresh();
	}, [open]);

	// 订阅安装进度(仅打开时)
	useEffect(() => {
		if (!open) return;
		const off = window.piApi.onOcrInstallProgress((line) => setInstallLog((l) => [...l, line]));
		return off;
	}, [open]);

	// 终端日志自动滚到底
	useEffect(() => {
		if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
	}, [installLog]);

	const installRapid = async () => {
		setInstallOpen(true);
		setInstalling(true);
		setInstallLog([]);
		setInstallDone(null);
		const r = await window.piApi.ocrInstallRapidocr();
		setInstalling(false);
		setInstallDone(r === "ok" ? "ok" : "error");
		if (r === "ok") {
			pushToast("RapidOCR 安装完成", "info");
			await refresh();
		} else {
			setInstallLog((l) => [...l, `❌ ${r}`]);
		}
	};

	const closeInstall = () => {
		setInstallOpen(false);
		setInstallDone(null);
	};

	const savePath = async (key: "cliPath" | "nodePath" | "pythonPath", val: string) => {
		await window.piApi.configSet({ [key]: val } as Partial<PiConfig>);
		pushToast(
			`${key === "cliPath" ? "pi" : key === "nodePath" ? "Node" : "Python"} 路径已保存${key !== "pythonPath" ? ",重启后端生效" : ""}`,
			"info",
		);
		await refresh();
	};

	/** 恢复自动:清空手动配置,回到自动检测/内置兜底链 */
	const resetPath = async (key: "cliPath" | "nodePath") => {
		await window.piApi.configSet({ [key]: "" } as Partial<PiConfig>);
		pushToast(`${key === "cliPath" ? "pi" : "Node"} 已恢复自动检测`, "info");
		await refresh();
	};

	if (!open) return null;

	const pyOk = env?.python.ok ?? false;
	const rapidOk = env?.rapidocr ?? false;
	const canRapid = pyOk && rapidOk;

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				className="animate-modal w-[600px] h-[480px] flex bg-card border border-sep rounded-2xl shadow-xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				{/* 左侧导航 */}
				<div className="w-40 shrink-0 bg-side border-r border-sep flex flex-col py-3">
					<div className="px-3 pb-2 mb-1 text-[11px] font-medium text-txt2">设置</div>
					{([
						{ key: "env", label: "环境检测" },
						{ key: "ocr", label: "OCR 引擎" },
						{ key: "mcp", label: "MCP 服务器" },
					] as const).map((item) => (
						<button
							key={item.key}
							onClick={() => setTab(item.key)}
							className={`text-left px-3 py-2 text-sm border-l-2 ${
								tab === item.key
									? "border-accent text-accent bg-card font-medium"
									: "border-transparent text-txt2 hover:text-txt"
							}`}
						>
							{item.label}
						</button>
					))}
				</div>

				{/* 右侧内容 */}
				<div className="flex-1 flex flex-col min-w-0">
					<div className="flex items-center justify-between px-5 py-3.5 border-b border-sep">
						<h2 className="text-sm font-semibold">
							{tab === "env" ? "环境检测" : tab === "ocr" ? "OCR 引擎" : "MCP 服务器"}
						</h2>
						<button
							onClick={onClose}
							title="关闭"
							className="w-6 h-6 flex items-center justify-center text-txt2 hover:text-txt btn-press"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
						</button>
					</div>

					<div className="flex-1 overflow-auto px-5 py-4">
						{tab === "env" && (
							<div>
								<div className="flex items-center justify-between mb-2">
									<button
										onClick={() => void refresh()}
										disabled={loading}
										title="重新检测环境"
										className="text-xs text-txt2 hover:text-accent disabled:opacity-40 btn-press hover:bg-side rounded px-2 py-1 flex items-center gap-1"
									>
										<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg> {loading ? "检测中…" : "检测"}
									</button>
									{envTs && (
										<span className="text-[10px] text-txt2/60">上次检测:{new Date(envTs).toLocaleString()}</span>
									)}
								</div>
								<div className="divide-y divide-sep">
									<EnvRow
										badge="π"
										name="pi"
										ok={env?.pi.ok ?? false}
										path={env?.pi.path ?? ""}
										version={env?.pi.version}
										source={runtime?.cli.source}
										onSave={(p) => void savePath("cliPath", p)}
										onReset={() => void resetPath("cliPath")}
									/>
									<EnvRow
										badge="N"
										name="Node.js"
										ok={!!env?.node.path && runtime?.node.source !== "missing"}
										path={env?.node.path ?? ""}
										version={env?.node.version}
										source={runtime?.node.source}
										onSave={(p) => void savePath("nodePath", p)}
										onReset={() => void resetPath("nodePath")}
									/>
									<EnvRow
										badge="Py"
										name="Python"
										ok={pyOk}
										path={env?.python.path ?? ""}
										version={env?.python.version}
										onSave={(p) => void savePath("pythonPath", p)}
									/>
								</div>
								{!pyOk && (
									<div className="mt-3 text-[11px] text-orange bg-orange/10 rounded-lg px-3 py-2 leading-relaxed">
										{isMac ? (
											<>
												未检测到 Python。RapidOCR 需要 Python 3.10+,macOS 推荐用 Homebrew 安装:
												<code className="font-mono mx-1">brew install python@3.12</code>
												或访问 python.org 下载。安装后点"检测"重新检测。
											</>
										) : (
											<>
												未检测到 Python。RapidOCR 需要 Python 3.10+,推荐用 winget 安装:
												<code className="font-mono mx-1">winget install Python.Python.3.12</code>
												或访问 python.org 下载。安装后点"检测"重新检测。
											</>
										)}
									</div>
								)}
							</div>
						)}

						{tab === "ocr" && (
							<div className="space-y-2">
								<button
									onClick={() => setOcrEngine("tesseract")}
									className={`w-full text-left p-3 rounded-xl border transition-colors ${
										ocrEngine === "tesseract" ? "border-accent bg-accent-soft" : "border-sep hover:bg-side"
									}`}
								>
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium">
											tesseract <span className="text-[10px] text-txt2 font-normal">默认 · 纯 JS · 无需环境</span>
										</span>
										{ocrEngine === "tesseract" && <span className="text-[10px] text-accent">已选</span>}
									</div>
									<p className="text-[11px] text-txt2 mt-1">开箱即用,无需安装任何依赖;中文识别一般。</p>
								</button>

								<button
									onClick={() => {
										if (canRapid) setOcrEngine("rapidocr");
									}}
									className={`w-full text-left p-3 rounded-xl border transition-colors ${
										ocrEngine === "rapidocr"
											? "border-accent bg-accent-soft"
											: canRapid
												? "border-sep hover:bg-side"
												: "border-sep opacity-80"
									}`}
								>
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium">
											RapidOCR <span className="text-[10px] text-txt2 font-normal">强 · PaddleOCR · 需 Python</span>
										</span>
										{ocrEngine === "rapidocr" ? (
											<span className="text-[10px] text-accent">已选</span>
										) : rapidOk ? (
											<span className="text-[10px] text-green">✓ 可用</span>
										) : (
											<span className="text-[10px] text-txt2">未安装</span>
										)}
									</div>
									<p className="text-[11px] text-txt2 mt-1">
										基于 PaddleOCR ONNX 模型,中文识别更强;需本地 Python + rapidocr-onnxruntime 包。
									</p>
									{pyOk && !rapidOk && (
										<div className="mt-2">
											<button
												onClick={(e) => {
													e.stopPropagation();
													void installRapid();
												}}
												disabled={installing}
												className="btn-press text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
											>
												{installing ? "安装中…" : "安装 RapidOCR(约 100MB)"}
											</button>
										</div>
									)}
									{!pyOk && (
										<p className="text-[11px] text-orange mt-2">请先在"环境检测"安装 Python,再安装 RapidOCR。</p>
									)}
								</button>
							</div>
						)}

						{tab === "mcp" && <McpManagerPanel />}
					</div>
				</div>

				{/* 安装进度弹窗(终端风格,覆盖在设置面板之上) */}
				{installOpen && (
					<div
						className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
						onClick={(e) => {
							e.stopPropagation();
							if (!installing) closeInstall();
						}}
					>
						<div className="animate-modal w-[560px] rounded-xl overflow-hidden shadow-2xl border border-sep bg-card">
							{/* 终端标题栏:红黄绿圆点 + 标题 */}
							<div className="flex items-center gap-2 px-4 py-2.5 bg-side border-b border-sep">
								<span className="w-3 h-3 rounded-full bg-red" />
								<span className="w-3 h-3 rounded-full bg-orange" />
								<span className="w-3 h-3 rounded-full bg-green" />
								<span className="ml-2 text-xs text-txt2 font-mono">rapidocr-install — bash</span>
							</div>
							{/* 终端主体:黑底 monospace,逐行日志 + 闪烁光标 */}
							<div
								ref={termRef}
								className="bg-[#0d1117] p-4 h-72 overflow-auto font-mono text-[12px] leading-relaxed"
							>
								<div className="text-green">$ python -m pip install rapidocr-onnxruntime</div>
								{installLog.map((line, i) => (
									<div key={i} className="text-txt2/80 whitespace-pre-wrap break-all">
										{line}
									</div>
								))}
								{installing && <div className="text-green animate-pulse">▋</div>}
								{installDone === "ok" && <div className="text-green mt-1">✓ 安装完成</div>}
								{installDone === "error" && <div className="text-red mt-1">✗ 安装失败,见上方日志</div>}
							</div>
							{/* 底栏:状态 + 关闭按钮 */}
							<div className="flex items-center justify-between px-4 py-2.5 border-t border-sep">
								<span className="text-xs text-txt2">
									{installing
										? "正在安装…(约 1-2 分钟,下载约 100MB)"
										: installDone === "ok"
											? "RapidOCR 已就绪,可切换引擎"
											: "安装失败,请检查日志"}
								</span>
								{!installing && (
									<button
										onClick={closeInstall}
										className="text-xs bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90"
									>
										关闭
									</button>
								)}
							</div>
						</div>
					</div>
				)}
				</div>
			</div>,
			document.body,
		);
}
