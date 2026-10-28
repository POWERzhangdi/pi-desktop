/**
 * 阶段 0 验证:pi + MCP 扩展 → 测试 server 的端到端链路。
 *
 * 流程:spawn pi --mode rpc --no-session → get_state(等扩展加载完成)
 * → prompt 让模型调用 mcp_test_echo → 校验出现 tool_execution_start(end)
 * 且最终文本包含 "hello-from-mcp"。
 *
 * 退出码:0 通过,1 失败/超时。
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { cliPath, assertPi } from "./lib/pi.mjs";

assertPi();

const TOTAL_TIMEOUT_MS = 150_000;

const cwd = process.cwd();

let proc;
let exited = false;
let currentAssistantText = "";
let lastCompletedText = "";
let toolCalled = false;

let sawExtensionError = false;
const eventSeq = [];
const pending = new Map();

function fail(reason) {
	if (exited) return;
	exited = true;
	console.error(`\n[probe] FAIL: ${reason}`);
	try {
		proc?.kill();
	} catch {}
	process.exit(1);
}

function pass() {
	if (exited) return;
	exited = true;
	console.log("\n[probe] PASS");
	try {
		proc?.kill();
	} catch {}
	process.exit(0);
}

function pushEvent(name) {
	const last = eventSeq[eventSeq.length - 1];
	if (last && last.name === name) last.count++;
	else eventSeq.push({ name, count: 1 });
}

function printEventSeq() {
	console.log(
		"[probe] 事件序列:\n  " +
			eventSeq.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(" → "),
	);
}

function send(cmd) {
	proc.stdin.write(JSON.stringify(cmd) + "\n");
}

function onMessage(msg) {
	if (msg.type === "response" && msg.id !== undefined) {
		const entry = pending.get(msg.id);
		if (entry) {
			pending.delete(msg.id);
			entry(msg);
		}
		return;
	}

	let name = msg.type;
	if (msg.type === "message_update" && msg.assistantMessageEvent?.type) {
		name = `message_update:${msg.assistantMessageEvent.type}`;
		if (msg.assistantMessageEvent.type === "text_delta" && typeof msg.assistantMessageEvent.delta === "string") {
			currentAssistantText += msg.assistantMessageEvent.delta;
		}
	}
	pushEvent(name);

	if (msg.type === "message_start" && msg.message?.role === "assistant") {
		currentAssistantText = "";
	}
	if (msg.type === "message_end" && msg.message?.role === "assistant") {
		lastCompletedText = currentAssistantText || lastCompletedText;
	}
	if (msg.type === "tool_execution_start") {
		console.log(`[probe] 工具调用开始: ${msg.toolName}`);
		if (msg.toolName === "mcp_test_echo") toolCalled = true;
	}
	if (msg.type === "tool_execution_end") {
		const text =
			msg.result?.content
				?.filter((b) => b?.type === "text")
				.map((b) => b.text)
				.join("") ?? "";
		if (text) {
			toolResultText = text;
			console.log(`[probe] 工具结果: ${JSON.stringify(text.slice(0, 200))}`);
		}
		if (msg.isError) console.log(`[probe] 工具返回 isError=true`);
	}
	if (msg.type === "extension_error") {
		sawExtensionError = true;
		console.error(`[probe] 扩展错误: ${JSON.stringify(msg).slice(0, 500)}`);
	}
	if (msg.type === "agent_end") onAgentEnd(msg);
}

function onAgentEnd(agentEndEvt) {
	let finalText = lastCompletedText || currentAssistantText;
	if (!finalText && Array.isArray(agentEndEvt.messages)) {
		for (let i = agentEndEvt.messages.length - 1; i >= 0; i--) {
			const m = agentEndEvt.messages[i];
			if (m?.role === "assistant" && Array.isArray(m.content)) {
				finalText = m.content
					.filter((b) => b?.type === "text")
					.map((b) => b.text)
					.join("");
				break;
			}
		}
	}

	printEventSeq();
	console.log(`[probe] 最终 assistant 文本: ${JSON.stringify(finalText?.slice(0, 300))}`);
	if (sawExtensionError) fail("出现 extension_error");
	if (!toolCalled) fail("模型没有调用 mcp_test_echo 工具");
	if (!/hello-from-mcp/.test(finalText ?? "")) fail("最终文本不包含 hello-from-mcp");
	pass();
}

function main() {
	console.log(`[probe] cli: ${cliPath}`);
	console.log(`[probe] cwd: ${cwd}`);

	proc = spawn(process.execPath, [cliPath, "--mode", "rpc", "--no-session"], {
		cwd,
		env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});

	proc.on("error", (err) => fail(`spawn 失败: ${err.message}`));
	proc.on("exit", (code) => fail(`pi 进程提前退出,退出码 ${code}`));
	proc.stderr.on("data", (d) => {
		const s = d.toString("utf8").trim();
		if (s) console.error(`[pi stderr] ${s.slice(0, 300)}`);
	});

	const decoder = new StringDecoder("utf8");
	let buf = "";
	proc.stdout.on("data", (chunk) => {
		buf += decoder.write(chunk);
		for (;;) {
			const idx = buf.indexOf("\n");
			if (idx === -1) break;
			let line = buf.slice(0, idx);
			buf = buf.slice(idx + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line.trim()) continue;
			try {
				onMessage(JSON.parse(line));
			} catch {
				console.warn(`[probe] 非 JSON 行,跳过: ${line.slice(0, 120)}`);
			}
		}
	});

	setTimeout(() => fail(`总超时 ${TOTAL_TIMEOUT_MS / 1000}s`), TOTAL_TIMEOUT_MS);

	pending.set(1, (resp) => {
		if (!resp.success) fail(`get_state 失败: ${resp.error}`);
		console.log(`[probe] get_state 成功: model=${resp.data?.model?.id ?? "无"}`);
		pending.set(2, (resp2) => {
			if (!resp2.success) fail(`prompt 被拒绝: ${resp2.error}`);
			console.log("[probe] prompt 已接受,等待事件流…");
		});
		console.log('[probe] 发送 prompt: 调用 mcp_test_echo 工具');
		send({
			id: 2,
			type: "prompt",
			message:
				'请调用 mcp_test_echo 工具,参数 message 填 "hello-from-mcp"。然后把工具返回的内容原样告诉我,不要做其他事情。',
		});
	});
	send({ id: 1, type: "get_state" });
}

main();
