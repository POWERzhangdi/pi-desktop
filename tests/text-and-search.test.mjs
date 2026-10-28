/** 文本工具与 @ 文件补全的模糊匹配 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/load.mjs";

const { contentToText } = await loadSource("src/shared/text.ts");
const { fuzzyScore } = await loadSource("src/main/files.ts");

test("contentToText:字符串 / 文本块 / 混合块", () => {
	assert.equal(contentToText("abc"), "abc");
	assert.equal(
		contentToText([
			{ type: "text", text: "a" },
			{ type: "image", data: "xx" },
			{ type: "text", text: "b" },
		]),
		"ab",
	);
	assert.equal(contentToText(null), "");
	assert.equal(contentToText(42), "");
});

test("fuzzyScore:按序命中得分,失配返回 -1", () => {
	assert.ok(fuzzyScore("abc", "a-b-c") > 0);
	assert.equal(fuzzyScore("xyz", "abc"), -1);
	assert.ok(fuzzyScore("", "anything") >= 0);
});

test("fuzzyScore:连续命中优于分散命中,词首有加分", () => {
	const consecutive = fuzzyScore("read", "readme.md");
	const scattered = fuzzyScore("read", "zzread.md");
	assert.ok(consecutive > scattered);
	// 词首命中("com-…")优于词中命中("xcom…")
	const wordStart = fuzzyScore("com", "com-tool.ts");
	const midWord = fuzzyScore("com", "xcompliance.ts");
	assert.ok(wordStart > midWord);
});
