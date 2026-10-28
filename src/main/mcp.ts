/**
 * MCP 服务器配置管理:
 * - McpStore:读写 ~/.pi/agent/mcp.json(与 auth.json/models.json 同目录)
 * - ensureMcpExtension:把仓库里的 MCP 扩展(extensions/mcp)部署到
 *   ~/.pi/agent/extensions/mcp/,SDK 缺失时自动 npm install
 * - testMcpServer:spawn probe.mjs 用 SDK 连一次 server 并 list_tools
 *
 * pi 进程启动时由扩展读取 mcp.json,配置变更后必须重启全部后端进程(同 providers)。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { McpServerConfig, McpTestResult } from "../shared/ipc";
import { runNpmInstall } from "./proc";
import { writeJsonAtomic } from "./util/json-file";

interface McpConfigFile {
	servers?: McpServerConfig[];
}

export class McpStore {
	constructor(private readonly mcpPath: string) {}

	private read(): McpConfigFile {
		try {
			const parsed = JSON.parse(readFileSync(this.mcpPath, "utf8")) as McpConfigFile;
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}

	private write(file: McpConfigFile): void {
		// 原子写:pi 进程会在启动时读这份文件,不能让它读到半截 JSON
		writeJsonAtomic(this.mcpPath, file);
	}

	listServers(): McpServerConfig[] {
		return this.read().servers ?? [];
	}

	/** 新增/编辑;originalId 用于改名。校验失败抛 Error(中文信息,UI 展示) */
	upsertServer(server: McpServerConfig, originalId?: string): void {
		const id = server.id.trim();
		const name = server.name.trim();
		if (!id) throw new Error("id 不能为空");
		if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("id 只能包含字母/数字/下划线/中划线");
		if (!name) throw new Error("名称不能为空");
		if (server.transport !== "stdio" && server.transport !== "http") {
			throw new Error("传输类型只能是 stdio 或 http");
		}
		if (server.transport === "stdio") {
			if (!server.command?.trim()) throw new Error("stdio 传输需要填写启动命令");
		} else if (!server.url?.trim()) {
			throw new Error("http 传输需要填写 URL");
		}

		const file = this.read();
		const servers = [...(file.servers ?? [])];
		// 编辑时按 originalId 定位;新建时不做定位(重名 id 直接拒绝)
		const idx = originalId ? servers.findIndex((s) => s.id === originalId) : -1;
		const normalized: McpServerConfig = {
			...server,
			id,
			name,
			command: server.command?.trim() || undefined,
			url: server.url?.trim() || undefined,
			cwd: server.cwd?.trim() || undefined,
		};
		if (idx >= 0) servers[idx] = normalized;
		else {
			if (servers.some((s) => s.id === id)) throw new Error(`id「${id}」已存在`);
			servers.push(normalized);
		}
		this.write({ servers });
	}

	removeServer(serverId: string): void {
		const file = this.read();
		this.write({ servers: (file.servers ?? []).filter((s) => s.id !== serverId) });
	}
}

/** 把仓库里的扩展源文件部署到 pi 扩展目录;SDK 缺失时自动 npm install */
export async function ensureMcpExtension(sourceDir: string, destDir: string): Promise<void> {
	mkdirSync(destDir, { recursive: true });
	for (const file of ["index.ts", "package.json", "probe.mjs"]) {
		copyFileSync(join(sourceDir, file), join(destDir, file));
	}
	const sdkPath = join(destDir, "node_modules", "@modelcontextprotocol", "sdk");
	if (!existsSync(sdkPath)) {
		await runNpmInstall(destDir);
	}
}

/** 用扩展目录里的 probe.mjs 连接一次 server 并 list_tools */
export function testMcpServer(probePath: string, server: McpServerConfig): Promise<McpTestResult> {
	return new Promise((resolve) => {
		const proc = spawn(process.execPath, [probePath, JSON.stringify(server)], {
			windowsHide: true,
		});
		let out = "";
		let err = "";
		proc.stdout.on("data", (d) => (out += d.toString("utf8")));
		proc.stderr.on("data", (d) => (err += d.toString("utf8")));
		proc.on("error", (e) => resolve({ ok: false, error: `启动失败: ${e.message}` }));
		proc.on("close", (code) => {
			try {
				const line = out
					.trim()
					.split("\n")
					.filter((l) => l.trim())
					.pop();
				resolve(JSON.parse(line ?? "") as McpTestResult);
			} catch {
				resolve({ ok: false, error: err.trim() || `探测进程退出码 ${code}` });
			}
		});
	});
}
