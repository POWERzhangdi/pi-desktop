/** 自研 tar 读写:往返一致性(含 >100 字节长路径,走 GNU longname) */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSource } from "./helpers/load.mjs";

const { writeTarFile, extractTarFile } = await loadSource("src/main/util/tar.ts");

test("tar 往返:普通文件/子目录/空文件", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-tar-"));
	try {
		const src = join(root, "src");
		mkdirSync(join(src, "a", "b"), { recursive: true });
		writeFileSync(join(src, "top.txt"), "hello", "utf8");
		writeFileSync(join(src, "a", "b", "nested.json"), '{"k":1}', "utf8");
		writeFileSync(join(src, "empty.bin"), "", "utf8");

		const tar = join(root, "out.tar");
		writeTarFile(src, tar);

		const dest = join(root, "dest");
		mkdirSync(dest, { recursive: true });
		const files = extractTarFile(tar, dest);

		assert.equal(files, 3);
		assert.equal(readFileSync(join(dest, "top.txt"), "utf8"), "hello");
		assert.equal(readFileSync(join(dest, "a", "b", "nested.json"), "utf8"), '{"k":1}');
		assert.equal(readFileSync(join(dest, "empty.bin"), "utf8"), "");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("tar 往返:超过 100 字节的长路径(GNU longname)", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-tar-long-"));
	try {
		const src = join(root, "src");
		// 目录 + 文件名合计 > 100 字节,强制走 longname
		const deepDir = join(src, "node_modules", "@scope", "pkg", "esm", "models", "operations");
		const longName = `${"very-".repeat(18)}long-name.js`;
		mkdirSync(deepDir, { recursive: true });
		writeFileSync(join(deepDir, longName), "module.exports = 1;", "utf8");
		assert.ok(Buffer.byteLength(join("node_modules", "@scope", "pkg", "esm", "models", "operations", longName)) > 100);

		const tar = join(root, "out.tar");
		writeTarFile(src, tar);

		const dest = join(root, "dest");
		mkdirSync(dest, { recursive: true });
		extractTarFile(tar, dest);

		assert.equal(
			readFileSync(join(dest, "node_modules", "@scope", "pkg", "esm", "models", "operations", longName), "utf8"),
			"module.exports = 1;",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("tar 解包覆盖同名文件", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-tar-over-"));
	try {
		const src = join(root, "src");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "a.txt"), "new", "utf8");
		const tar = join(root, "out.tar");
		writeTarFile(src, tar);

		const dest = join(root, "dest");
		mkdirSync(dest, { recursive: true });
		writeFileSync(join(dest, "a.txt"), "old", "utf8");
		extractTarFile(tar, dest);
		assert.equal(readFileSync(join(dest, "a.txt"), "utf8"), "new");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
