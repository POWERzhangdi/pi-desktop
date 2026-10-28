/**
 * pi RPC 冒烟脚本(纯 Node ESM,由 Windows node 执行)。
 *
 * 流程:spawn pi --mode rpc --no-session → get_state → prompt "只回复 ok 两个字"
 * → 打印事件类型序列(连续同类合并计数)→ agent_end 后校验最终文本含 "ok"。
 *
 * 注意:脚本在 Windows 侧运行,所有路径必须是 Windows 风格。
 * 退出码:0 通过,1 失败/超时。
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import { cliPath, assertPi } from "./lib/pi.mjs";

assertPi();

const TOTAL_TIMEOUT_MS = 120_000;

const cwd = process.cwd(); // npm run 时即项目目录(Windows 路径)

let proc;
let currentAssistantText = "";
let lastCompletedText = "";
/** 压缩后的事件序列:[{ name, count }] */
const eventSeq = [];
const pending = new Map();
let exited = false;

function fail(reason, code = 1) {
	if (exited) return;
	exited = true;
	console.error(`\n[smoke] FAIL: ${reason}`);
	try {
		proc?.kill();
	} catch {}
	process.exit(code);
}

function pass() {
	if (exited) return;
	exited = true;
	console.log("\n[smoke] PASS");
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
	console.log("[smoke] 事件序列:");
	console.log("  " + eventSeq.map((e) => (e.count > 1 ? `${e.name} ×${e.count}` : e.name)).join(" → "));
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

	// 事件:压缩记录(message_update 记录 assistantMessageEvent 子类型)
	let name = msg.type;
	if (msg.type === "message_update" && msg.assistantMessageEvent?.type) {
		name = `message_update:${msg.assistantMessageEvent.type}`;
		const ame = msg.assistantMessageEvent;
		if (ame.type === "text_delta" && typeof ame.delta === "string") {
			currentAssistantText += ame.delta;
		}
	}
	pushEvent(name);

	if (msg.type === "message_start" && msg.message?.role === "assistant") {
		currentAssistantText = "";
	}
	if (msg.type === "message_end" && msg.message?.role === "assistant") {
		lastCompletedText = currentAssistantText || lastCompletedText;
	}
	if (msg.type === "agent_end") {
		onAgentEnd(msg);
	}
}

async function onAgentEnd(agentEndEvt) {
	// 兜底:从 agent_end.messages 里取最后一条 assistant 文本
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
	console.log(`[smoke] 最终 assistant 文本: ${JSON.stringify(finalText)}`);

	const hasDelta = eventSeq.some((e) => e.name === "message_update:text_delta");
	if (!hasDelta) {
		fail("事件序列中没有 text_delta");
	}
	if (!/ok/i.test(finalText)) {
		fail("最终文本不含 ok");
	}
	pass();
}

function main() {
	console.log(`[smoke] cli: ${cliPath}`);
	console.log(`[smoke] cwd: ${cwd}`);

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

	// 自写 JSONL 分帧:Buffer→string 按 \n 切,留残段
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
				console.warn(`[smoke] 非 JSON 行,跳过: ${line.slice(0, 120)}`);
			}
		}
	});

	// 总超时
	setTimeout(() => fail(`总超时 ${TOTAL_TIMEOUT_MS / 1000}s`), TOTAL_TIMEOUT_MS);

	// 1) get_state
	pending.set(1, (resp) => {
		if (!resp.success) fail(`get_state 失败: ${resp.error}`);
		const d = resp.data ?? {};
		console.log(
			`[smoke] get_state 成功: model=${d.model?.id ?? "无"} thinking=${d.thinkingLevel} sessionId=${d.sessionId}`,
		);
		// 2) prompt
		pending.set(2, (resp2) => {
			if (!resp2.success) fail(`prompt 被拒绝: ${resp2.error}`);
			console.log("[smoke] prompt 已接受,等待事件流…");
		});
		console.log('[smoke] 发送 prompt: "只回复 ok 两个字"');
		send({ id: 2, type: "prompt", message: "只回复 ok 两个字" });
	});
	send({ id: 1, type: "get_state" });
}

main();
