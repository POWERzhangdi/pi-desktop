/**
 * 热感知验证:运行中的 pi RPC 进程,在 auth.json / models.json 被外部修改后,
 * get_available_models 是否能立刻看到新 provider(不重启进程)。
 *
 * 流程:
 *  1) spawn pi --mode rpc --no-session
 *  2) get_available_models → 基线(provider 列表)
 *  3) 写入 deepseek 假 key 到 auth.json、dummy 自定义 provider 到 models.json
 *  4) 同一进程再次 get_available_models → 检查 deepseek / dummy 是否出现
 *  5) finally 恢复原 auth.json / models.json
 *
 * 退出码:0 热感知生效;2 不生效(需要重启后端);1 失败。
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";
import { join } from "node:path";

const cliPath = join(
	homedir(),
	"AppData",
	"Roaming",
	"npm",
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"cli.js",
);
const agentDir = join(homedir(), ".pi", "agent");
const authPath = join(agentDir, "auth.json");
const modelsPath = join(agentDir, "models.json");

const origAuth = readFileSync(authPath, "utf8");
const origModels = readFileSync(modelsPath, "utf8");

let proc;
let exited = false;
const pending = new Map();

function restore() {
	try { writeFileSync(authPath, origAuth); } catch (e) { console.error("恢复 auth.json 失败!", e); }
	try { writeFileSync(modelsPath, origModels); } catch (e) { console.error("恢复 models.json 失败!", e); }
}

function finish(code, msg) {
	if (exited) return;
	exited = true;
	console.log(`\n[hot] ${msg}`);
	restore();
	try { proc?.kill(); } catch {}
	process.exit(code);
}

function send(cmd) { proc.stdin.write(JSON.stringify(cmd) + "\n"); }

function onMessage(msg) {
	if (msg.type === "response" && msg.id !== undefined) {
		const entry = pending.get(msg.id);
		if (entry) { pending.delete(msg.id); entry(msg); }
	}
}

function providersOf(resp) {
	const models = resp.data?.models ?? [];
	return [...new Set(models.map((m) => m.provider))];
}

function main() {
	proc = spawn(process.execPath, [cliPath, "--mode", "rpc", "--no-session"], {
		cwd: process.cwd(),
		env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	proc.on("error", (e) => finish(1, `spawn 失败: ${e.message}`));
	proc.on("exit", (c) => finish(1, `pi 提前退出:${c}`));

	const decoder = new StringDecoder("utf8");
	let buf = "";
	proc.stdout.on("data", (chunk) => {
		buf += decoder.write(chunk);
		for (;;) {
			const i = buf.indexOf("\n");
			if (i === -1) break;
			let line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line.trim()) continue;
			try { onMessage(JSON.parse(line)); } catch {}
		}
	});

	setTimeout(() => finish(1, "总超时"), 60_000);

	// 1) 基线
	pending.set(1, (resp) => {
		if (!resp.success) finish(1, `基线 get_available_models 失败: ${resp.error}`);
		const before = providersOf(resp);
		console.log(`[hot] 基线 providers: ${before.join(", ") || "(空)"}`);

		// 2) 外部改文件
		const auth = JSON.parse(origAuth);
		auth["deepseek"] = { type: "api_key", key: "sk-dummy-hot-test" };
		writeFileSync(authPath, JSON.stringify(auth, null, 2));

		const models = JSON.parse(origModels);
		models.providers["dummy-hot-test"] = {
			baseUrl: "http://127.0.0.1:9/v1",
			api: "openai-completions",
			apiKey: "dummy",
			models: [{ id: "dummy-model-1", name: "Dummy Model 1", reasoning: false,
				input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000, maxTokens: 4096 }],
		};
		writeFileSync(modelsPath, JSON.stringify(models, null, 2));
		console.log("[hot] 已写入 deepseek 假 key + dummy-hot-test provider,同进程重新查询…");

		// 3) 同进程再查
		pending.set(2, (resp2) => {
			if (!resp2.success) finish(1, `第二次 get_available_models 失败: ${resp2.error}`);
			const after = providersOf(resp2);
			console.log(`[hot] 修改后 providers: ${after.join(", ") || "(空)"}`);
			const gotDeepseek = after.includes("deepseek");
			const gotDummy = after.includes("dummy-hot-test");
			console.log(`[hot] deepseek 出现: ${gotDeepseek} / dummy 自定义出现: ${gotDummy}`);
			if (gotDeepseek && gotDummy) finish(0, "结论:热感知生效,保存后无需重启后端");
			else if (gotDeepseek || gotDummy) finish(2, "结论:部分热感知(见上),实现时需区分处理");
			else finish(2, "结论:不热感知,保存后需重启对应工作区后端进程");
		});
		send({ id: 2, type: "get_available_models" });
	});
	send({ id: 1, type: "get_available_models" });
}

main();
