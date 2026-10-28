/**
 * 内置 pi 运行时:打包时以单个 tar 载荷随应用附带(build/runtime.tar),
 * 首次启动解到用户目录 `~/.pi-desktop/runtime/pi/<piVersion>/`。
 *
 * 为什么不直接放在安装目录里跑:
 * - 内置 pi 由「系统 node」以子进程执行,子进程读不了 asar 内部路径;
 * - 把 1.9 万个文件的 node_modules 解到 app.asar.unpacked,安装目录会变成一堆散文件;
 * - 用户目录里的运行时路径可见、可单独替换/升级,卸载应用也不会误删。
 *
 * 载荷用 tar 而不是目录:electron-builder 的 `files: ["!node_modules/**"]`
 * 会把 extraResources 里的 node_modules 一并过滤掉。
 */
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { extractTarFile } from "./util/tar";

const REL_CLI = join("node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");

/** 用户目录下的运行时根(每个版本一个子目录) */
export function runtimeRoot(): string {
	return join(homedir(), ".pi-desktop", "runtime", "pi");
}

/** 随包附带的载荷(tar + 小 manifest) */
function sourcePayload(): { tar: string; version: string } | null {
	const tar = join(process.resourcesPath, "runtime.tar");
	const manifest = join(process.resourcesPath, "runtime.manifest.json");
	if (!existsSync(tar) || !existsSync(manifest)) return null;
	try {
		const version = String(JSON.parse(readFileSync(manifest, "utf8")).piVersion ?? "");
		return version ? { tar, version } : null;
	} catch {
		return null;
	}
}

/** 某版本的 cli 路径(未安装返回 null) */
function installedCli(version: string): string | null {
	const cli = join(runtimeRoot(), version, REL_CLI);
	return existsSync(cli) ? cli : null;
}

/** 已安装的最高版本 cli(manifest 丢失时也能兜底) */
function latestInstalledCli(): string | null {
	try {
		const versions = readdirSync(runtimeRoot(), { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			// 版本号按数字段排序(0.84.1 < 0.90.0),不依赖字典序
			.sort((a, b) => {
				const pa = a.split(".").map(Number);
				const pb = b.split(".").map(Number);
				for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
					const d = (pa[i] ?? 0) - (pb[i] ?? 0);
					if (d !== 0) return d;
				}
				return 0;
			})
			.reverse();
		for (const v of versions) {
			const cli = installedCli(v);
			if (cli) return cli;
		}
	} catch {
		/* 目录还不存在 */
	}
	return null;
}

/** 当前可用的内置 pi cli(开发态=项目 node_modules;安装版=用户目录) */
export function bundledPiCliPath(): string | null {
	if (!app.isPackaged) {
		// 开发态直接用项目里的依赖(REL_CLI 已包含 node_modules 段,别再拼一次)
		const cli = join(app.getAppPath(), REL_CLI);
		return existsSync(cli) ? cli : null;
	}
	return latestInstalledCli();
}

/** 本次启动是否需要解包安装(用于决定是否显示"正在准备运行时"提示窗) */
export function needsRuntimeInstall(): boolean {
	if (!app.isPackaged) return false;
	const source = sourcePayload();
	return !!source && !installedCli(source.version);
}

/** 只保留指定版本,清掉历史版本目录 */
function pruneOtherVersions(keep: string): void {
	try {
		for (const entry of readdirSync(runtimeRoot(), { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === keep) continue;
			rmSync(join(runtimeRoot(), entry.name), { recursive: true, force: true });
		}
	} catch {
		/* 清理失败不影响主流程 */
	}
}

/**
 * 首次启动安装内置运行时(幂等)。
 * 失败不阻塞启动:配置解析会退回「缺失」,由设置面板给出可操作提示。
 */
export async function ensureBundledRuntime(): Promise<void> {
	if (!app.isPackaged) return;

	const source = sourcePayload();
	if (source && installedCli(source.version)) {
		pruneOtherVersions(source.version);
		return;
	}
	if (!source) return; // 载荷缺失(或已被清理),交给「内置 pi 缺失」的错误提示

	const target = join(runtimeRoot(), source.version);
	mkdirSync(target, { recursive: true });
	const started = Date.now();
	const files = extractTarFile(source.tar, target);
	console.log(
		`[runtime] 内置 pi ${source.version} 已安装到 ${target}(${files} 个文件,${Date.now() - started}ms)`,
	);

	pruneOtherVersions(source.version);

	// 解包成功后清掉 tar(安装目录通常可写);失败则保留,下次启动重试
	try {
		rmSync(source.tar, { force: true });
	} catch {
		/* 安装目录只读时保留载荷 */
	}
}

