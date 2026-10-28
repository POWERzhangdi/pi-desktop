/**
 * 模型连接测试冒烟(不启动 Electron,不碰真实网络/密钥):
 * 起一个本地 mock OpenAI 兼容 server,验证 testProviderConnection 的
 * - baseUrl 缺 /v1 → 404 失败(复现常见路径错误)
 * - baseUrl 带 /v1 → 成功
 * - $ENV 引用 key 被解析
 * - models 模式(GET /models)成功
 *
 * 用法:node scripts/test-provider.mjs
 * 退出码:0 通过,1 失败。
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createServer } from "node:http";
import { piRoot } from "./lib/pi.mjs";

const jitiPath = join(piRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url, {});
const { testProviderConnection } = await jiti.import(
	new URL("../src/main/providers.ts", import.meta.url).href,
);

let failures = 0;
function check(name, cond, extra) {
	if (cond) console.log(`  ✓ ${name}`);
	else {
		failures++;
		console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
	}
}

// 本地 mock:OpenAI 兼容端点,只有 /v1/chat/completions 和 /v1/models 存在
const server = createServer((req, res) => {
	if (req.method === "POST" && req.url === "/v1/chat/completions") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "pong" } }] }));
		return;
	}
	if (req.method === "GET" && req.url === "/v1/models") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
		return;
	}
	res.writeHead(404);
	res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

try {
	console.log("[test] baseUrl 缺 /v1(应失败,复现 404)");
	const bad = await testProviderConnection({
		mode: "chat",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${port}`,
		apiKey: "dummy-key",
		model: "mock-model",
	});
	check("返回 ok=false", bad.ok === false, JSON.stringify(bad));
	check("错误含 404", /404/.test(bad.error ?? ""), JSON.stringify(bad));

	console.log("[test] baseUrl 带 /v1(应成功)");
	const good = await testProviderConnection({
		mode: "chat",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${port}/v1`,
		apiKey: "dummy-key",
		model: "mock-model",
	});
	check("返回 ok=true", good.ok === true, JSON.stringify(good));

	console.log("[test] $ENV 引用 key");
	process.env.PROVIDER_TEST_ENV_KEY = "env-key";
	const envRef = await testProviderConnection({
		mode: "chat",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${port}/v1`,
		apiKey: "$PROVIDER_TEST_ENV_KEY",
		model: "mock-model",
	});
	check("返回 ok=true", envRef.ok === true, JSON.stringify(envRef));

	console.log("[test] models 模式(内置 provider 用)");
	const modelsProbe = await testProviderConnection({
		mode: "models",
		api: "openai-completions",
		baseUrl: `http://127.0.0.1:${port}/v1`,
		apiKey: "dummy-key",
	});
	check("返回 ok=true", modelsProbe.ok === true, JSON.stringify(modelsProbe));
} finally {
	server.close();
}

console.log(failures === 0 ? "\n[test] PASS" : `\n[test] FAIL(${failures})`);
process.exit(failures === 0 ? 0 : 1);
