/**
 * MCP 服务:配置读写 + 扩展部署 + 连接测试。
 * 从 ipc.ts 抽出来,让 IPC 注册只做参数转发(ipc.ts 之前既管状态又管文件操作)。
 */
import { app } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig, McpTestResult } from "../../shared/ipc";
import { McpStore, ensureMcpExtension, testMcpServer } from "../mcp";

export class McpService {
	private readonly store: McpStore;
	private readonly destDir: string;
	/** 部署完成(含 npm install)只做一次;失败允许重试 */
	private ready: Promise<void> | null = null;

	constructor() {
		const agentDir = join(homedir(), ".pi", "agent");
		this.store = new McpStore(join(agentDir, "mcp.json"));
		this.destDir = join(agentDir, "extensions", "mcp");
	}

	/** 确保扩展已部署(SDK 缺失时自动 npm install),幂等 */
	ensureDeployed(): Promise<void> {
		if (!this.ready) {
			// 开发:项目根 extensions/;打包后:extraResources 里的 resources/extensions/
			const sourceDir = app.isPackaged
				? join(process.resourcesPath, "extensions", "mcp")
				: join(app.getAppPath(), "extensions", "mcp");
			this.ready = ensureMcpExtension(sourceDir, this.destDir).catch((err) => {
				this.ready = null; // 失败后允许重试
				throw err;
			});
		}
		return this.ready;
	}

	listServers(): McpServerConfig[] {
		return this.store.listServers();
	}

	upsert(server: McpServerConfig, originalId?: string): McpServerConfig[] {
		this.store.upsertServer(server, originalId);
		return this.store.listServers();
	}

	remove(serverId: string): McpServerConfig[] {
		this.store.removeServer(serverId);
		return this.store.listServers();
	}

	test(server: McpServerConfig): Promise<McpTestResult> {
		return testMcpServer(join(this.destDir, "probe.mjs"), server);
	}
}
