/**
 * 工作区文件扫描(供输入框 @ 引用补全)。
 * 递归扫描 cwd(限深 3 层,排除 node_modules/.git/dist 等常见忽略目录与隐藏目录),
 * 模糊匹配 query(子串忽略大小写,匹配文件名或绝对路径),返回 ≤50 条,带 10s 缓存避免每次击键扫描。
 */
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FileEntry } from "../shared/ipc";

const EXCLUDE = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"out",
	".cache",
	".turbo",
	"coverage",
	".output",
	".nuxt",
	".vercel",
	"target",
	"bin",
	"obj",
	".idea",
	".vscode",
	".gradle",
	".settings",
	"__pycache__",
	".pytest_cache",
]);
const MAX_DEPTH = 12;
const MAX_RESULTS = 50;
const MAX_SCAN = 100_000; // 扫描上限(防极端,EXCLUDE 已排除 node_modules/target 等大头)
const CACHE_MS = 60_000;

const cache = new Map<string, { files: FileEntry[]; ts: number }>();

/** 模糊匹配分数:query 字符按顺序在 target 中出现则返回正分(连续/词首加分),否则 -1 */
function fuzzyScore(query: string, target: string): number {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	let qi = 0;
	let score = 0;
	let consecutive = 0;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			qi++;
			consecutive++;
			score += 1 + consecutive;
			if (ti === 0 || /[/._-]/.test(t[ti - 1])) score += 5; // 词首加分
		} else {
			consecutive = 0;
		}
	}
	return qi < q.length ? -1 : score;
}

/** 递归收集 cwd 下所有文件(限深 + 排除) */
async function scanAll(cwd: string): Promise<FileEntry[]> {
	const result: FileEntry[] = [];
	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_DEPTH || result.length >= MAX_SCAN) return;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return; // 无权限等,跳过
		}
		// 先收集当前层所有项(确保顶层项目目录不被某个大项目的深层扫描挤掉),再递归子目录
		const subdirs: string[] = [];
		for (const e of entries) {
			if (result.length >= MAX_SCAN) return;
			if (e.name.startsWith(".") || EXCLUDE.has(e.name)) continue;
			const full = join(dir, e.name);
			const isDir = e.isDirectory();
			if (isDir || e.isFile()) {
				const rel = relative(cwd, full).replace(/\\/g, "/");
				const slash = rel.lastIndexOf("/");
				result.push({ name: e.name, path: full, dir: slash >= 0 ? rel.slice(0, slash) : "", isDir });
			}
			if (isDir) subdirs.push(full);
		}
		for (const sub of subdirs) {
			if (result.length >= MAX_SCAN) return;
			await walk(sub, depth + 1);
		}
	}
	await walk(cwd, 0);
	return result;
}

/** 模糊匹配 query;query 空 返回前 MAX_RESULTS 条全部 */
/** 只扫第一层(顶层目录+文件),快速;用于 @ 空展示 */
async function scanTop(cwd: string): Promise<FileEntry[]> {
	const result: FileEntry[] = [];
	let entries;
	try {
		entries = await readdir(cwd, { withFileTypes: true });
	} catch {
		return result;
	}
	for (const e of entries) {
		if (e.name.startsWith(".") || EXCLUDE.has(e.name)) continue;
		const isDir = e.isDirectory();
		if (isDir || e.isFile()) {
			result.push({ name: e.name, path: join(cwd, e.name), dir: "", isDir });
		}
	}
	return result;
}

export async function listFiles(cwd: string, query: string): Promise<FileEntry[]> {
	const q = query.trim().toLowerCase();
	const cached = cache.get(cwd);
	const fresh = cached && Date.now() - cached.ts < CACHE_MS;
	if (!q) {
		// 空 query:广度,只展示第一层级。缓存有则取,无则现场只扫第一层(快)
		const top = fresh ? cached!.files.filter((f) => f.dir === "") : await scanTop(cwd);
		top.sort((a, b) => (a.isDir ? 0 : 1) - (b.isDir ? 0 : 1) || a.name.localeCompare(b.name));
		return top.slice(0, MAX_RESULTS);
	}
	// 有 query:深度模糊匹配。缓存有则取,无则深扫填缓存
	let files = fresh ? cached!.files : null;
	if (!files) {
		files = await scanAll(cwd);
		cache.set(cwd, { files, ts: Date.now() });
	}
	const matched = files
		.map((f) => {
			const ns = fuzzyScore(q, f.name);
			const ps = ns >= 0 ? -1 : fuzzyScore(q, f.path);
			return { f, score: ns >= 0 ? ns + 10000 : ps };
		})
		.filter((m) => m.score >= 0)
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			if (a.f.name.length !== b.f.name.length) return a.f.name.length - b.f.name.length;
			const ra = a.f.isDir ? (a.f.dir === "" ? 0 : 1) : 2;
			const rb = b.f.isDir ? (b.f.dir === "" ? 0 : 1) : 2;
			return ra - rb;
		})
		.map((m) => m.f);
	return matched.slice(0, MAX_RESULTS);
}

/** 预热缓存(工作区激活时后台调,@ 时直接命中) */
export async function warmCache(cwd: string): Promise<void> {
	const now = Date.now();
	const cached = cache.get(cwd);
	if (cached && now - cached.ts < CACHE_MS) return;
	const files = await scanAll(cwd);
	cache.set(cwd, { files, ts: now });
}
