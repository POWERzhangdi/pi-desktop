/**
 * RpcClientPool:按 cwd 管理一组 pi RPC 进程(懒启动、保持存活)。
 * 每个 workspace 一个进程,事件/状态转发时包上 cwd 信封。
 */
import { EventEmitter } from "node:events";
import { RpcClient, resolveConfig } from "./client";
import type { PiConfig, RpcEventEnvelope, BackendStatusEnvelope } from "../../shared/ipc";

export class RpcClientPool extends EventEmitter {
	readonly config: PiConfig;
	private clients = new Map<string, RpcClient>();

	constructor(config?: PiConfig) {
		super();
		this.config = config ?? resolveConfig();
	}

	/** 是否已有该 cwd 的进程(不含已退出的) */
	has(cwd: string): boolean {
		return this.clients.has(cwd);
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
		(this as { config: PiConfig }).config = resolveConfig();
	}

	/** 关闭全部进程(应用退出时) */
	disposeAll(): void {
		for (const client of this.clients.values()) client.dispose();
		this.clients.clear();
		this.removeAllListeners();
	}
}
