/**
 * 探测:get_commands 返回的命令清单。
 * 用法:node scripts/probe-commands.mjs
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "node:os";
import { join } from "node:path";

const cliPath =
	process.env.PI_DESKTOP_CLI ||
	join(homedir(), "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
const cwd = process.argv[2] || process.cwd();

const proc = spawn(process.execPath, [cliPath, "--mode", "rpc", "--no-session"], {
	cwd,
	env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
	stdio: ["pipe", "pipe", "pipe"],
	windowsHide: true,
});

proc.on("error", (err) => {
	console.error("spawn 失败:", err.message);
	process.exit(1);
});
proc.on("exit", (code) => {
	console.error("pi 进程退出,code =", code);
	process.exit(1);
});
proc.stderr.on("data", (d) => process.stderr.write(`[pi stderr] ${d}`));

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
			const msg = JSON.parse(line);
			if (msg.type === "response" && msg.id === 1) {
				console.log(JSON.stringify(msg.data, null, 2));
				proc.kill();
				process.exit(0);
			}
		} catch {
			// 忽略非 JSON
		}
	}
});

setTimeout(() => {
	console.error("超时");
	proc.kill();
	process.exit(1);
}, 30000);

// 先 get_state 握手,再 get_commands
proc.stdin.write(JSON.stringify({ id: 0, type: "get_state" }) + "\n");
setTimeout(() => {
	proc.stdin.write(JSON.stringify({ id: 1, type: "get_commands" }) + "\n");
}, 2000);
