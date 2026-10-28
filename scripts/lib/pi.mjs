/**
 * 统一的 pi CLI 解析(与主进程 src/main/config/paths.ts 同一套优先级):
 *   PI_DESKTOP_CLI > ~/.pi-desktop/config.json 的 cliPath > 全局安装 > 项目内置依赖
 *
 * 之前每个脚本各自硬编码「全局安装路径」。项目改成「内置 pi 优先」之后,
 * 干净机器上这些脚本全部 ERR_MODULE_NOT_FOUND —— 集中到这里,只维护一处。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_REL = join("node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fromConfigFile() {
	try {
		const cfg = JSON.parse(readFileSync(join(homedir(), ".pi-desktop", "config.json"), "utf8"));
		return typeof cfg.cliPath === "string" && cfg.cliPath ? cfg.cliPath : "";
	} catch {
		return "";
	}
}

function globalCli() {
	const home = homedir();
	const roots = [
		join(process.env.APPDATA || join(home, "AppData", "Roaming"), "npm", "node_modules"),
		"/usr/local/lib/node_modules",
		join(home, ".npm-global", "lib", "node_modules"),
		"/opt/homebrew/lib/node_modules",
	];
	for (const root of roots) {
		const cli = join(root, "@earendil-works", "pi-coding-agent", "dist", "cli.js");
		if (existsSync(cli)) return cli;
	}
	return "";
}

export const cliPath =
	process.env.PI_DESKTOP_CLI || fromConfigFile() || globalCli() || join(projectRoot, PKG_REL);

/** pi 包根目录(脚本需要它来定位 jiti) */
export const piRoot = process.env.PI_DESKTOP_CLI_ROOT || resolve(dirname(cliPath), "..");

/** 找到就返回,找不到给出可操作的提示后退出 */
export function assertPi() {
	if (existsSync(cliPath)) return cliPath;
	console.error(
		`[pi] 找不到 pi CLI:${cliPath}\n` +
			`    可用 PI_DESKTOP_CLI 指定路径,或在项目里先执行 npm install(内置 pi)。`,
	);
	process.exit(1);
}
