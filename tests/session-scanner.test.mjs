/** 会话扫描器:标题提取、cwd 解析、坏文件跳过、增量缓存 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSource } from "./helpers/load.mjs";

const { scanSessions, clearSessionCache, makeTitle } = await loadSource("src/main/sessions/scanner.ts");

function writeSession(dir, name, { id = "s1", cwd = "C:\\proj", text = "hello world" } = {}) {
	const file = join(dir, name);
	mkdirSync(join(file, ".."), { recursive: true });
	const header = JSON.stringify({ type: "session", id, timestamp: "2026-01-01T00:00:00Z", cwd });
	const msg = JSON.stringify({ type: "message", message: { role: "user", content: text } });
	writeFileSync(file, `${header}\n${msg}\n`, "utf8");
	return file;
}

test("makeTitle 折叠空白并截断", () => {
	assert.equal(makeTitle("  a\n\n  b  "), "a b");
	assert.equal(makeTitle("x".repeat(100)).length, 61); // 60 + 省略号
});

test("扫描会话:标题/cwd/排序", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-scan-"));
	try {
		clearSessionCache();
		const dir = join(root, "--C--proj--");
		writeSession(dir, "a.jsonl", { id: "a", cwd: "C:\\proj", text: "第一个会话" });
		writeSession(dir, "b.jsonl", { id: "b", cwd: "C:\\other", text: "第二个会话" });

		const list = await scanSessions(root);
		assert.equal(list.length, 2);
		const a = list.find((s) => s.sessionId === "a");
		assert.equal(a?.title, "第一个会话");
		assert.equal(a?.cwd, "C:\\proj");
		// 按 mtime 倒序
		assert.ok(list[0].mtimeMs >= list[1].mtimeMs);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("增量缓存:文件变化后标题刷新", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-scan2-"));
	try {
		clearSessionCache();
		const dir = join(root, "--C--proj--");
		const file = writeSession(dir, "a.jsonl", { text: "旧标题" });
		assert.equal((await scanSessions(root))[0].title, "旧标题");

		// 内容变长(mtime + size 都变),应重新解析
		writeSession(dir, "a.jsonl", { text: "换了新标题,并且更长一些" });
		assert.equal((await scanSessions(root))[0].title, "换了新标题,并且更长一些");
		assert.ok(file.endsWith("a.jsonl"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("坏文件/非会话文件被跳过", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-scan3-"));
	try {
		clearSessionCache();
		const dir = join(root, "--C--proj--");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "broken.jsonl"), "not json\n", "utf8");
		writeFileSync(join(dir, "no-header.jsonl"), JSON.stringify({ type: "x" }) + "\n", "utf8");
		writeSession(dir, "ok.jsonl", { text: "正常" });

		const list = await scanSessions(root);
		assert.equal(list.length, 1);
		assert.equal(list[0].title, "正常");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("会话目录不存在返回空数组", async () => {
	clearSessionCache();
	assert.deepEqual(await scanSessions(join(tmpdir(), "pi-does-not-exist-xyz")), []);
});
