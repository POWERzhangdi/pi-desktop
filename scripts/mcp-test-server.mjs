/**
 * 极简 MCP stdio 测试 server(零依赖,纯 JSON-RPC 2.0 按行分帧)。
 * 供阶段 0 验证 pi MCP 扩展链路:pi 扩展 → SDK Client → 本 server。
 */
import { createInterface } from "node:readline";

const serverInfo = { name: "pi-desktop-test-mcp", version: "0.1.0" };

const TOOLS = [
	{
		name: "echo",
		description: "回显一段文字。",
		inputSchema: {
			type: "object",
			properties: {
				message: { type: "string", description: "要回显的文字" },
			},
			required: ["message"],
		},
	},
	{
		name: "add",
		description: "计算两个整数之和。",
		inputSchema: {
			type: "object",
			properties: {
				a: { type: "integer", description: "加数" },
				b: { type: "integer", description: "加数" },
			},
			required: ["a", "b"],
		},
	},
];

function reply(id, result) {
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id, code, message) {
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	const { id, method, params } = msg ?? {};
	if (method === "initialize") {
		reply(id, {
			protocolVersion: params?.protocolVersion || "2024-11-05",
			capabilities: { tools: {} },
			serverInfo,
		});
	} else if (method === "tools/list") {
		reply(id, { tools: TOOLS });
	} else if (method === "tools/call") {
		const name = params?.name;
		const args = params?.arguments ?? {};
		if (name === "echo") {
			reply(id, { content: [{ type: "text", text: `echo: ${String(args.message ?? "")}` }] });
		} else if (name === "add") {
			const a = Number(args.a);
			const b = Number(args.b);
			if (!Number.isFinite(a) || !Number.isFinite(b)) {
				replyError(id, -32602, "a/b 必须是数字");
				return;
			}
			reply(id, { content: [{ type: "text", text: `add: ${a} + ${b} = ${a + b}` }] });
		} else {
			replyError(id, -32602, `未知工具: ${name}`);
		}
	} else if (method === "ping") {
		reply(id, {});
	}
	// notifications/initialized 等无 id 的通知直接忽略
});
