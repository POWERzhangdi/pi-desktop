/**
 * MCP 连接探测(供桌面端"测试连接"按钮使用)。
 * 用法:node probe.mjs '<server-config-json>'
 * 成功输出 {"ok":true,"toolCount":N,"tools":[...]},失败输出 {"ok":false,"error":"..."}。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const CONNECT_TIMEOUT_MS = 8000;

function finish(result) {
	console.log(JSON.stringify(result));
	process.exit(result.ok ? 0 : 1);
}

async function main() {
	const server = JSON.parse(process.argv[2] ?? "{}");
	let transport;
	if (server.transport === "http") {
		if (!server.url) throw new Error("http 传输缺少 url");
		transport = new StreamableHTTPClientTransport(new URL(server.url));
	} else {
		if (!server.command) throw new Error("stdio 传输缺少 command");
		transport = new StdioClientTransport({
			command: server.command,
			args: server.args ?? [],
			...(server.env ? { env: { ...process.env, ...server.env } } : {}),
			...(server.cwd ? { cwd: server.cwd } : {}),
			stderr: "pipe",
		});
	}

	const client = new Client({ name: "pi-desktop-mcp-probe", version: "0.1.0" });
	const timer = setTimeout(() => {
		void transport.close().catch(() => {});
	}, CONNECT_TIMEOUT_MS);
	try {
		await client.connect(transport);
		const { tools } = await client.listTools();
		const list = (tools ?? []).map((t) => t.name);
		finish({ ok: true, toolCount: list.length, tools: list });
	} finally {
		clearTimeout(timer);
		await client.close().catch(() => {});
		await transport.close().catch(() => {});
	}
}

main().catch((err) => finish({ ok: false, error: err?.message ?? String(err) }));
