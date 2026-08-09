/**
 * 子进程工具:统一的 npm install 与 PATH 探测。
 *
 * Windows 上的坑:.cmd/.bat 不是独立可执行文件,spawn 必须加 shell: true,
 * 否则直接抛 EINVAL —— 集中到这里处理,避免各处各写一份再踩一遍。
 */
import { spawn, execFileSync } from "node:child_process";

/** 在 cwd 里跑 npm install(依赖是否已装由调用方判断),失败带退出码 */
export function runNpmInstall(cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const npm = process.platform === "win32" ? "npm.cmd" : "npm";
		const proc = spawn(npm, ["install", "--omit=dev", "--no-audit", "--no-fund"], {
			cwd,
			windowsHide: true,
			stdio: "ignore",
			// Windows 上 .cmd 必须经 shell 启动,否则 spawn 抛 EINVAL
			shell: process.platform === "win32",
		});
		proc.on("error", (err) => reject(new Error(`npm 启动失败: ${err.message}`)));
		proc.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`npm install 失败,退出码 ${code}`)),
		);
	});
}

/**
 * 在 PATH 上找可执行文件路径(同步;只在启动/配置变更时调用,耗时可忽略)。
 * Windows 用 where.exe(mac/linux 用 which) —— 不依赖 bash 的 PATH 翻译。
 * 找不到返回 ""。多个命中时优先返回存在的 .exe。
 */
export function findOnPath(cmd: string): string {
	try {
		const tool = process.platform === "win32" ? "where.exe" : "which";
		const out = execFileSync(tool, [cmd], { encoding: "utf8", windowsHide: true });
		const lines = out
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (lines.length === 0) return "";
		// 优先返回存在的可执行文件(where 可能先给 .cmd shim 或残留路径)
		return (
			lines.find((l) => /\.exe$/i.test(l)) ??
			lines.find((l) => /\.(cmd|bat|sh|bash)$/i.test(l)) ??
			lines[0]
		);
	} catch {
		return "";
	}
}
