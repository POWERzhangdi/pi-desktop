/**
 * RpcClientPool:按 cwd 管理一组 pi RPC 进程(懒启动、保持存活、空闲回收)。
 * 每个 workspace 一个进程,事件/状态转发时包上 cwd 信封。
 */
import { EventEmitter } from "node:events";
import { RpcClient, resolveConfig } from "./client";
import type { PiConfig, RpcEventEnvelope, BackendStatusEnvelope } from "../../shared/ipc";

/** 默认空闲回收阈值:10 分钟无活动且不在执行中则关闭(下次使用时懒启动) */
const DEFAULT_IDLE_MS = 10 * 60_000;
/** 巡检间隔 */
const SWEEP_INTERVAL_MS = 60_000;

export class RpcClientPool extends EventEmitter {
	/** 当前解析出的运行配置(配置写入后通过 reloadConfig 换成新对象) */
	config: PiConfig;
	private clients = new Map<string, RpcClient>();
	private readonly idleMs: number;
	private sweeper: NodeJS.Timeout;

	constructor(config?: PiConfig, opts: { idleMs?: number } = {}) {
		super();
		this.config = config ?? resolveConfig();
		this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
		this.sweeper = setInterval(() => this.reapIdle(), SWEEP_INTERVAL_MS);
		// 不阻止进程退出(测试/CLI 场景尤其重要)
		this.sweeper.unref?.();
	}

	/**
	 * 取(或懒启动)该 cwd 的客户端。
	 * start 是异步的,但不 await:client.send 内部会等待进行中的启动握手。
	 */
	ensure(cwd: string): RpcClient {
		let client = this.clients.get(cwd);
		if (client) return client;

		client = new RpcClient(this.config);
		this.clients.set(cwd, client);
		client.on("event", (evt) => {
			this.emit("event", { cwd, evt } satisfies RpcEventEnvelope);
		});
		client.on("status", (status) => {
			this.emit("status", { cwd, status } satisfies BackendStatusEnvelope);
		});
		void client.start(cwd).catch(() => {
			// 启动失败由 status(crashed)事件上报
		});
		return client;
	}

	/** 发送命令到指定 workspace(懒启动) */
	async send(cwd: string, cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
		return this.ensure(cwd).send(cmd);
	}

	/** 杀掉指定 workspace 的进程 */
	kill(cwd: string): void {
		const client = this.clients.get(cwd);
		if (!client) return;
		this.clients.delete(cwd);
		client.dispose();
	}

	/** 重启全部进程(provider/模型配置变更后调用;下次使用时懒启动) */
	restartAll(): void {
		for (const [cwd, client] of this.clients) {
			this.clients.delete(cwd);
			client.dispose();
		}
	}

	/** 重新读取配置文件并更新(配置写入后;改了 cliPath/nodePath 需再 restartAll) */
	reloadConfig(): void {
		this.config = resolveConfig();
	}

	/** 关闭全部进程(应用退出时) */
	disposeAll(): void {
		clearInterval(this.sweeper);
		for (const client of this.clients.values()) client.dispose();
		this.clients.clear();
		this.removeAllListeners();
	}

	/** 回收空闲进程:不在执行中、无挂起命令、超过阈值没活动 */
	private reapIdle(): void {
		for (const [cwd, client] of this.clients) {
			if (client.isBusy || client.pendingCount > 0) continue;
			if (client.idleMs < this.idleMs) continue;
			this.clients.delete(cwd);
			client.dispose();
		}
	}
}
