/**
 * 构建「内置 pi 运行时」载荷:
 *   build/runtime.tar            —— 完整运行时(含 node_modules 树)
 *   build/runtime.manifest.json  —— 版本信息(单独一个小文件,便于主进程读取)
 *
 * 为什么打 tar 而不是直接放目录:electron-builder 的 `files: ["!node_modules/**"]`
 * 会把 extraResources 里的 node_modules 一并过滤掉;打成单文件即可绕开路径匹配,
 * 同时安装目录里也只有一个文件,首次启动搬到用户目录后再解包。
 *
 * 只复制生产依赖闭包(npm ls --omit=dev),每个包只拷自身文件(嵌套依赖各自单独拷),
 * 避免父子目录重复复制导致载荷翻倍。
 */
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stagingDir = join(projectRoot, "build", "runtime-staging");
const tarPath = join(projectRoot, "build", "runtime.tar");
const manifestPath = join(projectRoot, "build", "runtime.manifest.json");
const piPkgDir = join(projectRoot, "node_modules", "@earendil-works", "pi-coding-agent");

if (!existsSync(piPkgDir)) {
	console.error("[runtime] 找不到内置 pi,请先执行 npm install");
	process.exit(1);
}

/** 生产依赖闭包(绝对路径,含嵌套包) */
function prodClosure() {
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	const stdout = execFileSync(npm, ["ls", "--omit=dev", "--all", "--parseable"], {
		cwd: projectRoot,
		encoding: "utf8",
		shell: process.platform === "win32", // Windows 上 .cmd 必须经 shell
		maxBuffer: 32 * 1024 * 1024,
	});
	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => resolve(line))
		.filter((p) => p !== projectRoot && existsSync(p));
}

/** 运行时用不到、但很占体积/文件数的东西:source map 与类型声明 */
const SKIP_FILE = /\.(map|d\.ts|d\.mts|d\.cts)$/i;

/** 拷贝一个包目录,但跳过其内部的 node_modules(子包各自有独立的闭包条目) */
function copyPackage(src, dest) {
	cpSync(src, dest, {
		recursive: true,
		filter: (source) => {
			const rel = relative(src, source);
			if (rel.split(/[\\/]/).includes("node_modules")) return false;
			if (SKIP_FILE.test(source)) return false;
			return true;
		},
	});
}

function dirSize(dir) {
	let total = 0;
	const stack = [dir];
	while (stack.length > 0) {
		const cur = stack.pop();
		for (const entry of readdirSync(cur, { withFileTypes: true })) {
			const full = join(cur, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.isFile()) total += statSync(full).size;
		}
	}
	return total;
}

// 用 jiti 复用主进程里的 tar 实现(避免两份格式代码)
const jiti = createJiti(import.meta.url, {});
const { writeTarFile } = await jiti.import(
	pathToFileURL(join(projectRoot, "src", "main", "util", "tar.ts")).href,
);

rmSync(stagingDir, { recursive: true, force: true });
rmSync(tarPath, { force: true });
mkdirSync(stagingDir, { recursive: true });

const packages = prodClosure();
for (const dir of packages) {
	copyPackage(dir, join(stagingDir, relative(projectRoot, dir)));
}

const piVersion = JSON.parse(readFileSync(join(piPkgDir, "package.json"), "utf8")).version;
const manifest = { piVersion, builtAt: new Date().toISOString(), packages: packages.length };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

const entries = writeTarFile(stagingDir, tarPath);
const stagingBytes = dirSize(stagingDir);
rmSync(stagingDir, { recursive: true, force: true }); // 只保留 tar,避免 build 目录翻倍

console.log(
	`[runtime] 已生成 build/runtime.tar:pi ${piVersion},${packages.length} 个包 / ${entries} 个条目,` +
		`未压缩 ${(stagingBytes / 1024 / 1024).toFixed(1)} MB → tar ${(statSync(tarPath).size / 1024 / 1024).toFixed(1)} MB`,
);
