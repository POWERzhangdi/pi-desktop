/** JSON 原子读写 + 命令审批策略(不碰真实 home 目录) */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSource } from "./helpers/load.mjs";

const { writeJsonAtomic, readJsonFile } = await loadSource("src/main/util/json-file.ts");
const { ApprovalPolicy } = await loadSource("src/main/approval.ts");

test("writeJsonAtomic 写入后可读回", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-json-"));
	try {
		const file = join(dir, "a.json");
		writeJsonAtomic(file, { a: 1, b: ["x"] });
		assert.deepEqual(readJsonFile(file, {}), { a: 1, b: ["x"] });
		// 目录被自动创建
		const nested = join(dir, "deep", "b.json");
		writeJsonAtomic(nested, { ok: true });
		assert.deepEqual(readJsonFile(nested, {}), { ok: true });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readJsonFile:schema 不合法/坏 JSON 回退默认值", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-json2-"));
	try {
		const corrupt = join(dir, "corrupt.json");
		writeFileSync(corrupt, "{not json", "utf8");
		assert.deepEqual(readJsonFile(corrupt, { fallback: true }), { fallback: true });
		assert.deepEqual(readJsonFile(join(dir, "missing.json"), 0), 0);
		const arr = join(dir, "arr.json");
		writeFileSync(arr, "[1,2,3]", "utf8");
		assert.deepEqual(readJsonFile(arr, null), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("审批策略:默认 approve(安全默认)", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-approval-"));
	try {
		const file = join(dir, "approval.json");
		const policy = new ApprovalPolicy(file);
		assert.equal(policy.mode("C:\\a"), "approve");
		assert.equal(policy.shouldAutoApprove("C:\\a"), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("审批策略:full 自动放行且持久化,非法值被拒绝", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-approval2-"));
	try {
		const file = join(dir, "approval.json");
		const policy = new ApprovalPolicy(file);
		policy.setMode("C:\\a", "full");
		assert.equal(policy.mode("C:\\a"), "full");
		assert.equal(policy.shouldAutoApprove("C:\\a"), true);
		assert.throws(() => policy.setMode("C:\\a", "whatever"));
		// 重新加载仍生效
		assert.equal(new ApprovalPolicy(file).mode("C:\\a"), "full");
		// 文件里不含其他工作区
		assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).modes, { "C:\\a": "full" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("审批策略:本轮自动批准在 beginTurn 后复位", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-approval3-"));
	try {
		const policy = new ApprovalPolicy(join(dir, "approval.json"));
		policy.setAutoTurn("C:\\a", true);
		assert.equal(policy.shouldAutoApprove("C:\\a"), true);
		policy.beginTurn("C:\\a");
		assert.equal(policy.shouldAutoApprove("C:\\a"), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
