/**
 * MCP 后端逻辑冒烟(不启动 Electron):
 * - McpStore 读写/改名/查重/删除(对临时 mcp.json)
 * - testMcpServer 通过真实 probe.mjs 连测试 server
 *
 * 用法:node scripts/test-mcp.mjs
 * 退出码:0 通过,1 失败。
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piRoot } from "./lib/pi.mjs";


const jitiPath = join(piRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url, {});
const { McpStore, testMcpServer } = await jiti.import(
	new URL("../src/main/mcp.ts", import.meta.url).href,
);

let failures = 0;
function check(name, cond, extra) {
	if (cond) console.log(`  ✓ ${name}`);
	else {
		failures++;
		console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
	}
}

const dir = mkdtempSync(join(tmpdir(), "pi-mcp-test-"));
const store = new McpStore(join(dir, "mcp.json"));

try {
	console.log("[test] McpStore 读写");
	check("初始为空", store.listServers().length === 0);

	store.upsertServer({
		id: "db",
		name: "数据库",
		transport: "stdio",
		command: "npx",
		args: ["-y", "some-server"],
		enabled: true,
	});
	check("新增后 1 条", store.listServers().length === 1);
	check("字段完整", store.listServers()[0].name === "数据库");

	// 改名:originalId=db,新 id=db2
	store.upsertServer(
		{ ...store.listServers()[0], id: "db2", name: "数据库2" },
		"db",
	);
	const afterRename = store.listServers();
	check("改名后仍 1 条", afterRename.length === 1 && afterRename[0].id === "db2");

	let dupThrown = false;
	try {
		store.upsertServer({ ...afterRename[0], id: "db2" });
	} catch {
		dupThrown = true;
	}
	check("重复 id 被拒绝", dupThrown);

	store.removeServer("db2");
	check("删除后为空", store.listServers().length === 0);

	console.log("[test] 文件内容为 JSON");
	const raw = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf8"));
	check("mcp.json 结构正确", Array.isArray(raw.servers));

	console.log("[test] testMcpServer(真实 probe + 测试 server)");
	const extDir = join(process.env.USERPROFILE, ".pi", "agent", "extensions", "mcp");
	const okResult = await testMcpServer(join(extDir, "probe.mjs"), {
		id: "test",
		name: "测试 MCP",
		transport: "stdio",
		command: "node",
		args: [fileURLToPath(new URL("./mcp-test-server.mjs", import.meta.url))],
		enabled: true,
	});
	check("连接成功", okResult.ok && okResult.toolCount === 2, JSON.stringify(okResult));

	const badResult = await testMcpServer(join(extDir, "probe.mjs"), {
		id: "bad",
		name: "坏",
		transport: "stdio",
		command: "definitely-not-a-command-xyz",
		enabled: true,
	});
	check("失败路径返回 ok=false", badResult.ok === false && !!badResult.error, JSON.stringify(badResult));
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\n[test] PASS" : `\n[test] FAIL(${failures})`);
process.exit(failures === 0 ? 0 : 1);
