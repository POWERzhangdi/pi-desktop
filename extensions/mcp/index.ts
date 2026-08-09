/**
 * pi MCP 扩展(阶段 0 验证版)。
 *
 * 启动时读取 ~/.pi/agent/mcp.json,连接各 MCP server,
 * 把 server 的 tools 通过 pi.registerTool() 注册成 pi 工具,
 * 工具名格式:mcp_<serverId>_<toolName>。
 *
 * 配置示例:
 * {
 *   "servers": [
 *     {
 *       "id": "test",
 *       "name": "测试 MCP",
 *       "transport": "stdio",
 *       "command": "node",
 *       "args": ["C:/path/to/pi-desktop/scripts/mcp-test-server.mjs"],
 *       "enabled": true
 *     }
 *   ]
 * }
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_PATH = join(
	process.env.USERPROFILE || process.env.HOME || "",
	".pi",
	"agent",
	"mcp.json",
);
const CONNECT_TIMEOUT_MS = 8000;

interface McpServerConfig {
	id: string;
	name?: string;
	transport: "stdio" | "http";
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	enabled?: boolean;
}

interface McpConfig {
	servers?: McpServerConfig[];
}

function readConfig(): McpConfig {
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as McpConfig;
	} catch {
		return {};
	}
}

/** 工具名前缀用:小写 + 非字母数字转 _ */
function sanitize(s: string): string {
	return (s || "")
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

/**
 * JSON Schema → TypeBox(覆盖常用子集:string/number/integer/boolean/
 * array/object/enum/anyOf/oneOf);不支持的语法退回 Type.Unknown(),
 * 保证工具仍能注册、LLM 仍能看到 description。
 */
function schemaToType(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return Type.Unknown();
	const s = schema as Record<string, unknown>;
	const desc =
		typeof s.description === "string" ? { description: s.description as string } : {};

	if (Array.isArray(s.enum) && s.enum.length > 0) {
		const items = s.enum.map((v) => {
			if (typeof v === "string") return Type.Literal(v);
			if (typeof v === "number") return Type.Literal(v);
			if (typeof v === "boolean") return Type.Literal(v);
			return Type.Unknown();
		});
		return items.length === 1 ? items[0] : Type.Union(items);
	}
	const union = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
	if (Array.isArray(union) && union.length > 0) {
		try {
			const items = union.map(schemaToType);
			return items.length === 1 ? items[0] : Type.Union(items);
		} catch {
			return Type.Unknown();
		}
	}
	if (typeof s.$ref === "string") return Type.Unknown();

	switch (s.type) {
		case "string":
			return Type.String(desc);
		case "number":
			return Type.Number(desc);
		case "integer":
			return Type.Integer(desc);
		case "boolean":
			return Type.Boolean(desc);
		case "null":
			return Type.Null(desc);
		case "array": {
			try {
				return Type.Array(schemaToType(s.items) as never, desc as never);
			} catch {
				return Type.Unknown();
			}
		}
		case "object": {
			const props: Record<string, unknown> = {};
			const rawProps = (s.properties ?? {}) as Record<string, unknown>;
			for (const [k, v] of Object.entries(rawProps)) {
				props[k] = schemaToType(v);
			}
			const required = new Set<string>((s.required as string[] | undefined) ?? []);
			for (const k of Object.keys(props)) {
				if (!required.has(k)) props[k] = Type.Optional(props[k] as never);
			}
			const opts: Record<string, unknown> = { ...desc };
			if (s.additionalProperties === true) opts.additionalProperties = true;
			return Type.Object(props as never, opts as never);
		}
		default:
			return Type.Unknown();
	}
}

/** MCP 结果 content 块 → 纯文本 */
function contentToText(content: Array<Record<string, unknown>> | undefined): string {
	const parts: string[] = [];
	for (const block of content ?? []) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text") parts.push(String(block.text ?? ""));
		else if (block.type === "image")
			parts.push(
				`[image: ${String(block.mimeType ?? "?")} (${Math.round(
					String(block.data ?? "").length / 1024,
				)} KB base64)]`,
			);
		else if (block.type === "resource")
			parts.push(String((block.resource as { text?: string; uri?: string } | undefined)?.text ?? ""));
		else if (block.type === "audio") parts.push(`[audio: ${String(block.mimeType ?? "?")}]`);
		else if (block.type === "video") parts.push(`[video: ${String(block.mimeType ?? "?")}]`);
		else parts.push(JSON.stringify(block));
	}
	return parts.join("\n");
}

export default async function (pi: ExtensionAPI): Promise<void> {
	const cfg = readConfig();
	const servers = (cfg.servers ?? []).filter((s) => s && s.enabled !== false);

	for (const server of servers) {
		const serverId = sanitize(server.id) || "server";
		try {
			const count = await connectServer(pi, server, serverId);
			console.error(`[mcp] ${server.id}: 注册 ${count} 个工具`);
		} catch (err) {
			console.error(`[mcp] server ${server.id} 连接失败: ${(err as Error)?.message ?? String(err)}`);
		}
	}
	console.error(`[mcp] 启动完成,共 ${servers.length} 个 server`);
}

async function connectServer(
	pi: ExtensionAPI,
	server: McpServerConfig,
	serverId: string,
): Promise<number> {
	let transport: StdioClientTransport | StreamableHTTPClientTransport;

	if (server.transport === "http") {
		if (!server.url) throw new Error("http transport 缺少 url");
		transport = new StreamableHTTPClientTransport(new URL(server.url));
	} else {
		if (!server.command) throw new Error("stdio transport 缺少 command");
		transport = new StdioClientTransport({
			command: server.command,
			args: server.args ?? [],
			...(server.env ? { env: { ...process.env, ...server.env } } : {}),
			...(server.cwd ? { cwd: server.cwd } : {}),
			stderr: "pipe",
		});
	}

	const client = new Client({ name: "pi-desktop-mcp", version: "0.1.0" });
	const timer = setTimeout(() => {
		void transport.close().catch(() => {});
	}, CONNECT_TIMEOUT_MS);
	try {
		await client.connect(transport);
	} finally {
		clearTimeout(timer);
	}

	// 排空 server stderr,避免 pipe 积压阻塞
	if (server.transport !== "http") {
		const t = transport as StdioClientTransport;
		(t as unknown as { stderr?: NodeJS.ReadableStream }).stderr?.on("data", (d: Buffer) =>
			console.error(`[mcp:${server.id}] ${d.toString("utf8").trimEnd()}`),
		);
	}

	const { tools } = await client.listTools();
	const seen = new Set<string>();
	for (const tool of tools ?? []) {
		let name = `mcp_${serverId}_${sanitize(tool.name)}`;
		while (seen.has(name)) name += "_2";
		seen.add(name);

		pi.registerTool({
			name,
			label: `${server.name ?? server.id} · ${tool.name}`,
			description: tool.description ?? `MCP 工具 ${server.id}/${tool.name}`,
			parameters: schemaToType(tool.inputSchema) as never,
			async execute(_toolCallId, args, signal) {
				const result = await client.callTool(
					{ name: tool.name, arguments: (args ?? {}) as Record<string, unknown> },
					undefined,
					{ signal },
				);
				const text = contentToText(result.content as Array<Record<string, unknown>>);
				if (result.isError) throw new Error(text || `MCP 工具 ${tool.name} 返回错误`);
				return { content: [{ type: "text" as const, text }], details: {} };
			},
		});
	}
	return (tools ?? []).length;
}
