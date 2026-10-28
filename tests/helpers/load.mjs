/**
 * 测试用的 TS 加载器。
 *
 * 源码用 TS 写、import 不带扩展名,原生 node --test 无法直接跑;
 * 这里复用 pi 包自带的 jiti(与 scripts/test-*.mjs 一致),不需要额外构建步骤。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { piRoot } from "../../scripts/lib/pi.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const jitiPath = join(piRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url, {});

/** 按「相对项目根」的路径加载 TS 模块 */
export function loadSource(relativePath) {
	return jiti.import(pathToFileURL(join(projectRoot, relativePath)).href);
}
