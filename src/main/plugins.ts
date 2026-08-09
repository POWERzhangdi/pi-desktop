/**
 * 内置插件部署器。
 *
 * 源:extensions/bundled(开发=项目根,打包后=resources/extensions/bundled)
 * 目标:~/.pi/agent/extensions/
 *
 * 幂等策略(每插件目录/顶层文件记录 sha256 清单 .pi-desktop-manifest.json):
 * - 源文件哈希变了(客户端升级)→ 覆盖目标
 * - 源没变而用户本地改过 → 保留用户版本
 * - 源里删除的托管文件 → 一并删除(用户自己的扩展不动)
 *
 * 依赖:带 package.json dependencies 的插件在首次使用时懒安装 npm install。
 */
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { runNpmInstall } from "./proc";

const MANIFEST_NAME = ".pi-desktop-manifest.json";

interface Manifest {
	appVersion?: string;
	files: Record<string, string>;
}

function sha256(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** 递归收集目录下所有文件(相对源根的 / 分隔路径),排除 node_modules/package-lock/隐藏文件 */
function walkFiles(dir: string, base: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === "package-lock.json" || e.name.startsWith(".")) continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) out.push(...walkFiles(full, base));
		else out.push(relative(base, full).replace(/\\/g, "/"));
	}
	return out;
}

/**
 * 同步内置插件到目标扩展目录。返回本次变更的文件列表(删除项以 "-" 开头)。
 * 幂等:无变更时返回空数组。
 */
export function syncBundledPlugins(
	sourceDir: string,
	destDir: string,
	appVersion = "",
): string[] {
	if (!existsSync(sourceDir)) return [];

	const current: Record<string, string> = {};
	for (const rel of walkFiles(sourceDir, sourceDir)) {
		current[rel] = sha256(join(sourceDir, rel));
	}

	const manifestPath = join(destDir, MANIFEST_NAME);
	let prev: Manifest = { files: {} };
	try {
		prev = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
	} catch {
		/* 无清单 = 首次部署 */
	}
	prev.files ??= {};

	const changed: string[] = [];
	for (const rel of Object.keys(current)) {
		const target = join(destDir, rel);
		if (prev.files[rel] !== current[rel]) {
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(join(sourceDir, rel), target);
			changed.push(rel);
		}
	}
	// 删除我方托管但源里已不存在的文件(仅限清单记录过的)
	for (const rel of Object.keys(prev.files)) {
		if (!(rel in current)) {
			const target = join(destDir, rel);
			if (existsSync(target)) {
				rmSync(target, { force: true });
				changed.push(`-${rel}`);
			}
		}
	}
	if (changed.length > 0 || !existsSync(manifestPath)) {
		mkdirSync(destDir, { recursive: true });
		writeFileSync(
			manifestPath,
			JSON.stringify({ appVersion, files: current }, null, 2),
			"utf8",
		);
	}
	return changed;
}

/** 依赖安装的缓存(并发调用只装一次) */
const depEnsure = new Map<string, Promise<void>>();

/**
 * 确保某扩展目录的 npm 依赖已安装(有 dependencies 且 node_modules 缺失时才装)。
 * 首次使用对应能力时懒调用;装完缓存,本次会话不再重复。
 */
export function ensurePluginDeps(destDir: string, name: string): Promise<void> {
	const key = join(destDir, name);
	if (!depEnsure.has(key)) {
		depEnsure.set(
			key,
			(async () => {
				const pkgPath = join(destDir, name, "package.json");
				if (!existsSync(pkgPath)) return;
				let pkg: { dependencies?: Record<string, string> };
				try {
					pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string> };
				} catch {
					return;
				}
				const deps = Object.keys(pkg.dependencies ?? {});
				if (deps.length === 0) return;
				if (existsSync(join(destDir, name, "node_modules"))) return;
				await runNpmInstall(join(destDir, name));
			})(),
		);
	}
	return depEnsure.get(key)!;
}
