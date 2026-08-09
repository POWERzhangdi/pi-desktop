/**
 * pi RPC 客户端:负责 spawn pi(--mode rpc)子进程、JSONL 分帧、
 * 命令/响应配对、事件分发、崩溃重启。
 *
 * 注意:不能用 Node readline 分帧 —— 它会把 U+2028/U+2029 当换行,
 * 而它们是 JSON 字符串内的合法字符。这里自己 Buffer→string 按 \n 切,留残段。
 */
import { EventEmitter } from "node:events";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { StringDecoder } from "node:string_decoder";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { PiConfig, BackendStatus } from "../../shared/ipc";

/** 响应等待超时(毫秒) */
const RESPONSE_TIMEOUT_MS = 180_000;
/** stderr 环形缓冲行数 */
const STDERR_RING_SIZE = 50;

interface PendingEntry {
	resolve: (value: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
}

/** 跨平台 home 目录 */
function homeDir(): string {
	return homedir();
}

/** 读取可选配置文件 ~/.pi-desktop/config.json,读不到返回 {} */
function readConfigFile(): Partial<PiConfig> {
	try {
		const home = homeDir();
		if (!home) return {};
		const raw = readFileSync(join(home, ".pi-desktop", "config.json"), "utf8");
		const parsed = JSON.parse(raw) as Partial<PiConfig>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** 写入配置文件(合并 patch) */
export function writeConfigFile(patch: Partial<PiConfig>): void {
	const home = homeDir();
	if (!home) return;
	const file = join(home, ".pi-desktop", "config.json");
	const merged = { ...readConfigFile(), ...patch };
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(merged, null, 2), "utf8");
}

/** 解析最终配置:环境变量 > 配置文件 > 默认值 */
export function resolveConfig(): PiConfig {
	const file = readConfigFile();
	const home = homeDir();
	const isWin = process.platform === "win32";
	const appData = process.env.APPDATA || join(home, "AppData", "Roaming");

	// node:Windows 优先常见安装路径;mac/Linux 直接用 PATH 上的 node(可用 PI_DESKTOP_NODE 覆盖)
	const winDefaultNode = "C:\\Program Files\\nodejs\\node.exe";
	const nodePath =
		process.env.PI_DESKTOP_NODE ||
		file.nodePath ||
		(isWin && existsSync(winDefaultNode) ? winDefaultNode : "node");

	const cliPath =
		process.env.PI_DESKTOP_CLI ||
		file.cliPath ||
		resolveDefaultCliPath(home, isWin, appData) ||
		resolveBundledCliPath();
	const sessionsDir = file.sessionsDir || join(home, ".pi", "agent", "sessions");
	// 兜底 cwd:未配置时用 ~/projects
	const cwd = file.cwd || join(home, "projects");
	return { nodePath, cliPath, sessionsDir, cwd, pythonPath: file.pythonPath };
}

/** 全局安装的 pi cli 默认路径 */
function resolveDefaultCliPath(home: string, isWin: boolean, appData: string): string {
	if (isWin) {
		return join(appData, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
	}
	// mac/Linux:`npm root -g` 拿全局 node_modules 目录(兼容 npm/nvm/brew 安装),失败退回常见路径
	const candidates: string[] = [];
	try {
		const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
		if (globalRoot) candidates.push(globalRoot);
	} catch {
		/* npm 不可用时退回常见路径 */
	}
	candidates.push(
		"/usr/local/lib/node_modules",
		join(home, ".npm-global", "lib", "node_modules"),
		"/opt/homebrew/lib/node_modules",
	);
	for (const root of candidates) {
		const p = join(root, "@earendil-works", "pi-coding-agent", "dist", "cli.js");
		if (existsSync(p)) return p;
	}
	// 全都没有:返回第一个候选,spawn 时给出清晰错误,设置面板可改路径
	return join(candidates[0] ?? home, "@earendil-works", "pi-coding-agent", "dist", "cli.js");
}

/** 客户端自带的 pi(作为 dependencies 打包进应用):本地没有全局 pi 时的兜底 */
function resolveBundledCliPath(): string {
	try {
		const require = createRequire(import.meta.url);
		return require.resolve("@earendil-works/pi-coding-agent/dist/cli.js");
	} catch {
		return "";
	}
}

/** 去掉 ANSI 转义,便于在 UI 展示 */
function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\[[0-9;?]*[a-zA-Z]/g, "");
}

export class RpcClient extends EventEmitter {
	readonly config: PiConfig;
	/** 当前工作目录(可能因 pickCwd 而改变) */
	currentCwd: string;

	private proc: ChildProcess | null = null;
	private nextId = 1;
	private pending = new Map<string | number, PendingEntry>();
	private stderrRing: string[] = [];
	private lineBuffer = "";
	private decoder = new StringDecoder("utf8");
	private disposed = false;
	private starting: Promise<void> | null = null;

	constructor(config?: PiConfig) {
		super();
		this.config = config ?? resolveConfig();
		this.currentCwd = this.config.cwd;
	}

	/** 进程是否存活 */
	private isAlive(): boolean {
		return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
	}

	/** 启动(或重启)RPC 子进程 */
	async start(cwd?: string): Promise<void> {
		if (cwd) this.currentCwd = cwd;
		if (this.starting) return this.starting;
		this.starting = this.doStart();
		try {
			await this.starting;
		} finally {
			this.starting = null;
		}
	}

	private async doStart(): Promise<void> {
		this.killProcess();
		this.disposed = false;
		this.emitStatus({ state: "starting" });

		const { nodePath, cliPath } = this.config;
		let proc: ChildProcess;
		try {
			proc = spawn(nodePath, [cliPath, "--mode", "rpc"], {
				cwd: this.currentCwd,
				env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (err) {
			// 同步抛错(如 cwd 不存在)
			this.emitStatus({ state: "crashed", detail: `spawn 失败: ${(err as Error).message}` });
			throw err;
		}
		this.proc = proc;
		this.lineBuffer = "";
		this.decoder = new StringDecoder("utf8");

		proc.stdout!.on("data", (chunk: Buffer) => this.onStdoutChunk(chunk));
		proc.stderr!.on("data", (chunk: Buffer) => this.onStderrChunk(chunk));
		proc.on("error", (err) => {
			// spawn 失败(如 nodePath 不存在)
			this.pushStderr(`spawn error: ${err.message}`);
			this.onProcessExit(-1);
		});
		proc.on("exit", (code, signal) => {
			this.onProcessExit(code ?? (signal ? -1 : 0));
		});

		// 启动握手:pi 就绪前不会主动输出,发一个 get_state 探活
		try {
			await this.send({ type: "get_state" });
			this.emitStatus({ state: "ready" });
		} catch (err) {
			// 握手失败多半意味着进程已退出,exit 处理器会发 crashed
			if (this.isAlive()) {
				this.emitStatus({ state: "crashed", detail: `握手失败: ${(err as Error).message}` });
			}
		}
	}

	/** stdout 数据:Buffer→string,按 \n 切分,留残段 */
	private onStdoutChunk(chunk: Buffer): void {
		this.lineBuffer += this.decoder.write(chunk);
		for (;;) {
			const idx = this.lineBuffer.indexOf("\n");
			if (idx === -1) break;
			let line = this.lineBuffer.slice(0, idx);
			this.lineBuffer = this.lineBuffer.slice(idx + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			this.onLine(line);
		}
	}

	private onLine(line: string): void {
		if (!line.trim()) return;
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(line) as Record<string, unknown>;
		} catch {
			// 非 JSON 行(如日志)跳过
			console.warn("[rpc] 非 JSON 行,跳过:", line.slice(0, 200));
			return;
		}

		if (msg.type === "response" && msg.id !== undefined) {
			const entry = this.pending.get(msg.id as string | number);
			if (entry) {
				this.pending.delete(msg.id as string | number);
				clearTimeout(entry.timer);
				if (msg.success) entry.resolve(msg);
				else entry.reject(new Error((msg.error as string) || "命令失败"));
			}
			// 无匹配 pending 的响应(迟到/重复)忽略
			return;
		}
		// 其余一律视为事件(含 extension_ui_request)
		this.emit("event", msg);
	}

	private onStderrChunk(chunk: Buffer): void {
		for (const line of chunk.toString("utf8").split(/\r?\n/)) {
			if (line.trim()) this.pushStderr(line);
		}
	}

	private pushStderr(line: string): void {
		this.stderrRing.push(stripAnsi(line));
		if (this.stderrRing.length > STDERR_RING_SIZE) {
			this.stderrRing.splice(0, this.stderrRing.length - STDERR_RING_SIZE);
		}
		console.error("[pi stderr]", line);
	}

	private onProcessExit(code: number): void {
		// error 与 exit 可能相继触发,只处理第一次
		if (!this.proc) return;
		this.proc.stdout?.removeAllListeners();
		this.proc.stderr?.removeAllListeners();
		this.proc.removeAllListeners();
		this.proc = null;
		const detail =
			this.stderrRing.slice(-10).join("\n") || `进程退出,退出码 ${code}`;
		this.emitStatus({ state: "crashed", detail: `退出码 ${code}\n${detail}` });
		// 拒绝所有挂起的命令
		const err = new Error("pi 进程已退出");
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(err);
		}
		this.pending.clear();
	}

	private emitStatus(s: BackendStatus): void {
		this.emit("status", s);
	}

	/**
	 * 发送命令并等待响应。
	 * - 自动附带自增 id(cmd 已带 id 则尊重原值)
	 * - extension_ui_response 是即发即弃(pi 不会回 response),立即 resolve
	 * - 进程已死时自动重启后再发
	 */
	async send(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (this.disposed) throw new Error("RPC 客户端已销毁");
		if (!this.isAlive()) {
			console.warn("[rpc] 进程不在运行,发送前自动重启");
			await this.start(this.currentCwd);
		}

		// 即发即弃的扩展 UI 响应
		if (cmd.type === "extension_ui_response") {
			this.writeLine(cmd);
			return { success: true };
		}

		// 尊重调用方自带的 id(string/number),否则自增
		const id: string | number =
			typeof cmd.id === "string" || typeof cmd.id === "number" ? cmd.id : this.nextId++;
		const wire = { ...cmd, id };
		return new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`命令 ${String(cmd.type)} 等待响应超时(180s)`));
			}, RESPONSE_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.writeLine(wire);
			} catch (err) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(err as Error);
			}
		});
	}

	private writeLine(obj: Record<string, unknown>): void {
		if (!this.proc?.stdin?.writable) throw new Error("pi 进程 stdin 不可写");
		this.proc.stdin.write(JSON.stringify(obj) + "\n");
	}

	/** 以新 cwd 重启 */
	async restart(cwd: string): Promise<void> {
		this.killProcess();
		await this.start(cwd);
	}

	private killProcess(): void {
		if (!this.proc) return;
		try {
			this.proc.stdin?.end();
			this.proc.kill();
		} catch {
			/* 忽略 kill 异常 */
		}
		this.proc = null;
		// 拒绝挂起命令
		const err = new Error("RPC 进程已重启");
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(err);
		}
		this.pending.clear();
	}

	/** 永久关闭(不再自动重启) */
	dispose(): void {
		this.disposed = true;
		this.killProcess();
		this.removeAllListeners();
	}
}
