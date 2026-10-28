/**
 * 主进程:加载 pi 扩展(jiti),调其 execute 处理文件,结果回填输入框。
 * PDF/Excel/OCR 三个能力按钮共用。OCR 支持 tesseract(默认) / rapidocr(PaddleOCR,中文强,需 Python)。
 * 含 Python 环境检测 + rapidocr 安装引导(用户决定下载,不打包进客户端)。
 */
import { pathToFileURL } from "node:url";
import { resolve, dirname, join } from "node:path";
import { dialog, type BrowserWindow, type FileFilter } from "electron";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { EnvInfo } from "../shared/ipc";
import { ensurePluginDeps } from "./plugins";

const toolCache = new Map<string, any>();
const loadingPromises = new Map<string, Promise<any>>();

/** 加载某扩展的某工具(缓存) */
async function loadTool(cliPath: string, extName: string, toolName: string): Promise<any> {
	const key = `${extName}/${toolName}`;
	if (toolCache.has(key)) return toolCache.get(key);
	if (loadingPromises.has(key)) return loadingPromises.get(key);
	const p = (async () => {
		// 首次使用前确保该扩展依赖已安装(有依赖且 node_modules 缺失时懒安装)
		await ensurePluginDeps(join(homedir(), ".pi", "agent", "extensions"), extName);
		const piRoot = resolve(dirname(cliPath), "..");
		const jitiPath = join(piRoot, "node_modules", "jiti", "lib", "jiti.mjs");
		const typeboxPath = join(piRoot, "node_modules", "typebox", "build", "index.mjs");
		const piMain = join(piRoot, "dist", "index.js");
		const home = homedir();
		const extPath = join(home, ".pi", "agent", "extensions", extName, "index.ts");

		const { createJiti } = await import(pathToFileURL(jitiPath).href);
		const jiti = createJiti(import.meta.url, {
			alias: { typebox: typeboxPath, "@earendil-works/pi-coding-agent": piMain },
			moduleCache: false,
		});
		const mod = await jiti.import(pathToFileURL(extPath).href, { default: true });
		const registered: any[] = [];
		mod({ registerTool: (d: any) => registered.push(d), on: () => {} });
		const tool = registered.find((t: any) => t.name === toolName);
		if (!tool) throw new Error(`${extName} 扩展未注册 ${toolName} 工具`);
		toolCache.set(key, tool);
		return tool;
	})();
	loadingPromises.set(key, p);
	return p;
}

/**
 * 调扩展工具的 execute。
 *
 * pi 的 ToolDefinition.execute 签名是 (toolCallId, params, signal, onUpdate, ctx);
 * 这里按函数 arity 适配而不是写死 5 参 —— 上游一旦调整参数个数,
 * 写死的调用会把 ctx 塞进 onUpdate 之类的槽位,静默失效且很难排查。
 */
function callToolExecute(
	tool: { execute: (...args: never[]) => unknown },
	params: Record<string, unknown>,
	ctx: Record<string, unknown>,
): Promise<{ content?: Array<{ text?: string }> }> {
	const fn = tool.execute as unknown as (...args: unknown[]) => Promise<{ content?: Array<{ text?: string }> }>;
	const arity = fn.length;
	if (arity >= 5) return fn("desktop", params, undefined, undefined, ctx);
	if (arity === 4) return fn("desktop", params, undefined, ctx);
	if (arity === 3) return fn("desktop", params, ctx);
	return fn("desktop", params, undefined, undefined, ctx);
}

async function execTool(
	cliPath: string, extName: string, toolName: string,
	params: Record<string, unknown>, cwd: string,
): Promise<string> {
	const tool = await loadTool(cliPath, extName, toolName);
	const ctx = { cwd, sessionManager: { getSessionId: () => "desktop" } };
	const result = await callToolExecute(tool, params, ctx);
	// 结果可能是多个 text 块,全部拼回来(只取第一块会丢内容)
	return (result?.content ?? [])
		.map((b) => (typeof b?.text === "string" ? b.text : ""))
		.join("")
		.trim();
}

async function pickAndExec(
	getWindow: () => BrowserWindow | null, cliPath: string,
	title: string, filters: FileFilter[],
	extName: string, toolName: string, extraParams: Record<string, unknown> = {},
): Promise<string> {
	const win = getWindow();
	if (!win) throw new Error("无可用窗口");
	const result = await dialog.showOpenDialog(win, { title, filters, properties: ["openFile", "multiSelections"] });
	if (result.canceled || result.filePaths.length === 0) return "";
	const texts: string[] = [];
	for (const p of result.filePaths) {
		texts.push(await execTool(cliPath, extName, toolName, { path: p, ...extraParams }, dirname(p)));
	}
	return texts.join("\n");
}

export function pdfExtract(getWindow: () => BrowserWindow | null, cliPath: string): Promise<string> {
	return pickAndExec(getWindow, cliPath, "选择要读取的 PDF", [{ name: "PDF", extensions: ["pdf"] }], "pdf-reader", "read_pdf");
}

export function excelExtract(getWindow: () => BrowserWindow | null, cliPath: string): Promise<string> {
	return pickAndExec(getWindow, cliPath, "选择要读取的 Excel/CSV", [{ name: "Excel/CSV", extensions: ["xlsx", "xls", "csv"] }], "excel-reader", "read_excel");
}

export function ocrRecognize(
	getWindow: () => BrowserWindow | null, cliPath: string, engine: "tesseract" | "rapidocr" = "tesseract",
	pythonPath?: string,
): Promise<string> {
	return pickAndExec(
		getWindow, cliPath, "选择要 OCR 识别的图片",
		[{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"] }],
		"ocr", "ocr", engine === "rapidocr" ? { engine, pythonPath } : {},
	);
}

/** 跑一条命令,返回 {ok, out} */
function runCmd(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
	return new Promise((res) => {
		const proc = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
		let out = "";
		proc.stdout.on("data", (d) => (out += d.toString("utf8")));
		proc.stderr.on("data", (d) => (out += d.toString("utf8")));
		proc.on("error", () => res({ ok: false, out: "" }));
		proc.on("close", (code) => res({ ok: code === 0, out }));
	});
}

/** 检测运行环境:pi / Node / Python 路径与版本 + rapidocr 是否就绪 */
export async function checkEnv(cliPath: string, nodePath: string, pythonPath?: string): Promise<EnvInfo> {
	const py = pythonPath || defaultPythonCmd();
	const piVer = await runCmd(nodePath, [cliPath, "--version"]);
	const pyExe = await runCmd(py, ["-c", "import sys;print(sys.executable)"]);
	const pyVer = await runCmd(py, ["--version"]);
	const pyOk = pyExe.ok && pyVer.ok;
	const rapidocr = pyOk ? (await runCmd(py, ["-c", "import rapidocr_onnxruntime"])).ok : false;
	return {
		pi: { ok: piVer.ok, path: cliPath, version: piVer.ok ? piVer.out.trim() : null },
		node: { path: nodePath, version: process.version },
		python: {
			ok: pyOk,
			path: pyOk ? pyExe.out.trim() : null,
			version: pyOk ? pyVer.out.trim().replace(/^Python\s+/i, "") : null,
		},
		rapidocr,
	};
}

/** 安装 rapidocr-onnxruntime(pip),onProgress 回调每行输出 */
export function installRapidocr(onProgress?: (line: string) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(defaultPythonCmd(), ["-m", "pip", "install", "--progress-bar", "on", "rapidocr-onnxruntime"], {
			windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
		});
		let stdout = "";
		const onLine = (d: Buffer) => {
			const s = d.toString("utf8");
			stdout += s;
			// \r(pip 下载进度条刷新)也当分行,让进度逐行滚动
			s.split(/[\r\n]+/).forEach((ln) => ln.trim() && onProgress?.(ln.trim()));
		};
		proc.stdout.on("data", onLine);
		proc.stderr.on("data", onLine);
		proc.on("error", (e) => reject(new Error(`pip 启动失败(未安装 Python?): ${e.message}`)));
		proc.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`pip 安装失败(退出码 ${code})`))));
	});
}

/** 平台默认 python 命令:Windows=python,mac/Linux=python3 */
function defaultPythonCmd(): string {
	return process.platform === "win32" ? "python" : "python3";
}
