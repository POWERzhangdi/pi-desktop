/**
 * 插件部署器冒烟(不启动 Electron):
 * 同步/幂等/用户改动保留/客户端升级覆盖/源删除清理/清单生成。
 * 用法:node scripts/test-plugins.mjs
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

const piRoot =
	process.env.PI_DESKTOP_CLI_ROOT ||
	join(homedir(), "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent");
const jitiPath = join(piRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url, {});
const { syncBundledPlugins } = await jiti.import(
	new URL("../src/main/plugins.ts", import.meta.url).href,
);

let failures = 0;
function check(name, cond, extra) {
	if (cond) console.log(`  ✓ ${name}`);
	else {
		failures++;
		console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
	}
}

const root = mkdtempSync(join(tmpdir(), "pi-plugins-test-"));
const src = join(root, "bundled");
const dst = join(root, "extensions");
try {
	mkdirSync(join(src, "pdf-reader"), { recursive: true });
	writeFileSync(join(src, "approve-bash.ts"), "v1-approve", "utf8");
	writeFileSync(join(src, "pdf-reader", "index.ts"), "v1-pdf", "utf8");
	writeFileSync(join(src, "pdf-reader", "package.json"), '{"dependencies":{}}', "utf8");

	console.log("[test] 首次同步");
	const c1 = syncBundledPlugins(src, dst, "0.1.0");
	check("复制了文件", c1.length === 3, JSON.stringify(c1));
	check("approve-bash.ts 就位", readFileSync(join(dst, "approve-bash.ts"), "utf8") === "v1-approve");
	check("子目录文件就位", readFileSync(join(dst, "pdf-reader", "index.ts"), "utf8") === "v1-pdf");
	check("清单生成", existsSync(join(dst, ".pi-desktop-manifest.json")));

	console.log("[test] 幂等(无变更不写)");
	const c2 = syncBundledPlugins(src, dst, "0.1.0");
	check("第二次无变更", c2.length === 0, JSON.stringify(c2));

	console.log("[test] 用户本地改动保留");
	writeFileSync(join(dst, "approve-bash.ts"), "user-edit", "utf8");
	const c3 = syncBundledPlugins(src, dst, "0.1.0");
	check("不覆盖用户改动", readFileSync(join(dst, "approve-bash.ts"), "utf8") === "user-edit", JSON.stringify(c3));

	console.log("[test] 客户端升级覆盖");
	writeFileSync(join(src, "approve-bash.ts"), "v2-approve", "utf8");
	const c4 = syncBundledPlugins(src, dst, "0.2.0");
	check("覆盖为新版本", readFileSync(join(dst, "approve-bash.ts"), "utf8") === "v2-approve", JSON.stringify(c4));

	console.log("[test] 源删除清理");
	rmSync(join(src, "pdf-reader", "index.ts"));
	const c5 = syncBundledPlugins(src, dst, "0.2.0");
	check("托管文件被清理", !existsSync(join(dst, "pdf-reader", "index.ts")), JSON.stringify(c5));
	check("保留目录", existsSync(join(dst, "pdf-reader", "package.json")));
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? "\n[test] PASS" : `\n[test] FAIL(${failures})`);
process.exit(failures === 0 ? 0 : 1);
