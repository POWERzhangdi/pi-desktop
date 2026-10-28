/**
 * pi RPC 客户端:负责 spawn pi(--mode rpc)子进程、JSONL 分帧、
 * 命令/响应配对、事件分发、崩溃重启。
 *
 * 注意:不能用 Node readline 分帧 —— 它会把 U+2028/U+2029 当换行,
 * 而它们是 JSON 字符串内的合法字符。这里自己 Buffer→string 按 \n 切,留残段。
 */
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { app } from "electron";
import type { PiConfig, BackendStatus } from "../../shared/ipc";
import { resolveConfig } from "../config/store";

export { resolveConfig, writeConfigFile } from "../config/store";

/** 响应等待超时(毫秒) */
const RESPONSE_TIMEOUT_MS = 180_000;
/** stderr 环形缓冲行数 */
const STDERR_RING_SIZE = 50;

interface PendingEntry {
	resolve: (value: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
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
	/** 是否有 agent 正在执行(空闲回收不能杀执行中的进程) */
	private busy = false;
	/** 最近一次活动时间(命令/响应/事件任一) */
	private lastActivityMs = Date.now();

	/** 是否处于一轮执行中 */
	get isBusy(): boolean {
		return this.busy;
	}

	/** 尚未收到响应的命令数 */
	get pendingCount(): number {
		return this.pending.size;
	}

	/** 距上次活动多久(毫秒) */
	get idleMs(): number {
		return Date.now() - this.lastActivityMs;
	}

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
		// 解析链兜底失败时给出可操作的提示,而不是 spawn 报晦涩错误
		if (!nodePath) {
			const detail = "未找到 Node.js。请在设置面板的\"环境检测\"中配置 Node 路径,或安装 Node.js(nodejs.org)";
			this.emitStatus({ state: "crashed", detail });
			throw new Error("nodePath 为空");
		}
		if (!cliPath) {
			// 安装版的内置 pi 在用户目录,缺失通常是运行时被手动删了
			const detail = app.isPackaged
				? "内置 pi 运行时缺失(通常位于 ~/.pi-desktop/runtime/pi)。请重新安装应用,或在设置面板的\"环境检测\"中指定 pi 路径"
				: "未找到 pi CLI。请在设置面板的\"环境检测\"中配置 pi 路径";
			this.emitStatus({ state: "crashed", detail });
			throw new Error("cliPath 为空");
		}
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
			const resp = await this.send({ type: "get_state" });
			// 协议自检:pi 升级后 get_state 结构变化时,给出可诊断的错误而不是让 UI 空着
			const state = resp.data as Record<string, unknown> | undefined;
			if (!state || typeof state.sessionId !== "string" || typeof state.isStreaming !== "boolean") {
				const detail = "pi 协议不兼容:get_state 返回结构异常(请确认 pi 版本与客户端匹配)";
				this.emitStatus({ state: "crashed", detail });
				this.killProcess();
				throw new Error(detail);
			}
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
		this.lastActivityMs = Date.now();
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
		// 维护 busy 标记:供池的空闲回收判断(执行中的进程不能回收)
		if (msg.type === "agent_start") this.busy = true;
		else if (msg.type === "agent_end" || msg.type === "agent_settled") this.busy = false;
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
		this.busy = false;
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
		this.lastActivityMs = Date.now();
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
