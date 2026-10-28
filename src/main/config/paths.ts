/**
 * pi / Node 可执行文件路径解析。
 *
 * 解析链:环境变量 > config.json > 自动检测 > 内置兜底。
 * 单独成文件是因为「设置面板展示来源」与「spawn 子进程」都要用同一套结果,
 * 不能各自算一份(之前的测试脚本就是因为另算了一份而漂移)。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { findOnPath } from "../proc";
import { bundledPiCliPath } from "../runtime";

/** config.json 的默认位置 */
export function configFilePath(): string {
	return join(homedir(), ".pi-desktop", "config.json");
}

/** 自动探测 node:常见安装路径 > PATH(where/which)。找不到返回 ""。 */
export function detectNodePath(): string {
	const candidates: string[] = [];
	if (process.platform === "win32") {
		candidates.push(join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe"));
		if (process.env["ProgramFiles(x86)"]) {
			candidates.push(join(process.env["ProgramFiles(x86)"], "nodejs", "node.exe"));
		}
		// nvm-windows:装的 node 是 %NVM_SYMLINK% 下的 node.exe
		if (process.env.NVM_SYMLINK) {
			candidates.push(join(process.env.NVM_SYMLINK, "node.exe"));
		}
	} else {
		candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node");
	}
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	const onPath = findOnPath("node");
	return onPath && existsSync(onPath) ? onPath : "";
}

/**
 * 探测全局安装的 pi cli。
 * Windows:先查 APPDATA\npm 默认全局目录,再用解析出的 node 跑 npm-cli.js root -g
 * (兼容 nvm/自定义 node 安装的全局根);mac/linux:直接用 npm root -g + 常见全局目录。
 * 找不到返回 ""(交由内置兜底)。
 */
export function detectGlobalCliPath(nodePath: string): string {
	const home = homedir();
	const isWin = process.platform === "win32";
	const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
	const candidates: string[] = [];
	if (isWin) {
		candidates.push(join(appData, "npm", "node_modules"));
		if (nodePath) {
			const npmCli = join(dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
			if (existsSync(npmCli)) {
				try {
					const root = execFileSync(nodePath, [npmCli, "root", "-g"], { encoding: "utf8" }).trim();
					if (root) candidates.push(root);
				} catch {
					/* 拿不到全局根就跳过 */
				}
			}
		}
	} else {
		try {
			const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
			if (globalRoot) candidates.push(globalRoot);
		} catch {
			/* npm 不可用时退回常见路径 */
		}
		candidates.push(
			"/usr/local/lib/node_modules",
			join(home, ".npm-global", "lib", "node_modules"),
			"/opt/homebrew/lib/node_modules",
		);
	}
	for (const root of candidates) {
		const p = join(root, "@earendil-works", "pi-coding-agent", "dist", "cli.js");
		if (existsSync(p)) return p;
	}
	return "";
}

/**
 * 客户端自带的 pi。
 * 开发态 = 项目 node_modules;安装版 = 用户目录
 * `~/.pi-desktop/runtime/pi/<version>/`(由 runtime.ts 首次启动从资源载荷搬过去)。
 * 具体路径解析在 runtime.ts,这里只做转发,避免两处各写一套候选路径。
 */
export function resolveBundledCliPath(): string {
	return bundledPiCliPath() ?? "";
}
