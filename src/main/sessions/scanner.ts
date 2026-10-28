/**
 * 会话文件扫描器:RPC 协议没有"列出会话"命令,这里直接扫描
 * %USERPROFILE%\.pi\agent\sessions\<转义cwd>\*.jsonl。
 *
 * 文件格式:首行 header {"type":"session","id","timestamp","cwd"},
 * 后续每行一个 entry,取第一条 role:"user" 的 message 文本截 60 字当标题。
 *
 * 性能:文件内容按 (mtime, size) 缓存 —— 每轮对话结束都会重扫一次,
 * 会话多时不能每次都重读每个文件头(单文件最多 64KB)。只有变化的文件才解析。
 */
import { readdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionSummary } from "../../shared/ipc";
import { contentToText } from "../../shared/text";

/** 单文件最多读取的字节数(标题通常在文件开头) */
const READ_WINDOW = 64 * 1024;
const TITLE_MAX = 60;
/** 并发解析上限(避免一次打开过多文件句柄) */
const PARSE_CONCURRENCY = 8;

interface CacheEntry {
	mtimeMs: number;
	size: number;
	summary: SessionSummary;
}

/** filePath -> 解析结果(仅在 mtime/size 未变时复用) */
const fileCache = new Map<string, CacheEntry>();


export function makeTitle(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	if (!oneLine) return "";
	return oneLine.length > TITLE_MAX ? oneLine.slice(0, TITLE_MAX) + "…" : oneLine;
}

/** 解析单个会话文件,失败返回 null */
async function parseSessionFile(filePath: string, mtimeMs: number): Promise<SessionSummary | null> {
	let fh;
	try {
		fh = await open(filePath, "r");
		const buf = Buffer.alloc(READ_WINDOW);
		const { bytesRead } = await fh.read(buf, 0, READ_WINDOW, 0);
		const text = buf.subarray(0, bytesRead).toString("utf8");
		const lines = text.split("\n");
		if (lines.length === 0) return null;

		const header = JSON.parse(lines[0]) as Record<string, unknown>;
		if (header.type !== "session" || typeof header.id !== "string") return null;

		// 找第一条 user 消息做标题
		let title = "";
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;
			try {
				const entry = JSON.parse(line) as {
					type?: string;
					message?: { role?: string; content?: unknown };
				};
				if (entry.type === "message" && entry.message?.role === "user") {
					title = makeTitle(contentToText(entry.message.content));
					if (title) break;
				}
			} catch {
				// 窗口截断导致的半行等,跳过
			}
		}

		return {
			filePath,
			sessionId: header.id,
			cwd: typeof header.cwd === "string" ? header.cwd : "",
			timestamp: typeof header.timestamp === "string" ? header.timestamp : "",
			title: title || "(空会话)",
			mtimeMs,
		};
	} catch {
		return null;
	} finally {
		await fh?.close().catch(() => {});
	}
}

/** 以有限并发执行任务 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const i = cursor++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]!);
		}
	});
	await Promise.all(workers);
	return results;
}

/** 扫描 sessionsDir 下所有子目录的 *.jsonl,按 mtime 倒序;目录不存在返回 [] */
export async function scanSessions(sessionsDir: string): Promise<SessionSummary[]> {
	let subdirs: string[];
	try {
		const entries = await readdir(sessionsDir, { withFileTypes: true });
		subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		fileCache.clear();
		return [];
	}

	const targets: Array<{ filePath: string; mtimeMs: number; size: number }> = [];
	for (const dir of subdirs) {
		const dirPath = join(sessionsDir, dir);
		let files: string[];
		try {
			files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}
		for (const file of files) {
			const filePath = join(dirPath, file);
			try {
				const st = await stat(filePath);
				targets.push({ filePath, mtimeMs: st.mtimeMs, size: st.size });
			} catch {
				// 单文件失败跳过
			}
		}
	}

	const results = await mapLimit(targets, PARSE_CONCURRENCY, async (t) => {
		const cached = fileCache.get(t.filePath);
		if (cached && cached.mtimeMs === t.mtimeMs && cached.size === t.size) return cached.summary;
		const summary = await parseSessionFile(t.filePath, t.mtimeMs);
		if (summary) fileCache.set(t.filePath, { mtimeMs: t.mtimeMs, size: t.size, summary });
		return summary;
	});

	// 清理已删除会话的缓存,避免长期运行后无限增长
	const live = new Set(targets.map((t) => t.filePath));
	for (const key of fileCache.keys()) {
		if (!live.has(key)) fileCache.delete(key);
	}

	const list = results.filter((s): s is SessionSummary => s !== null);
	list.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return list;
}

/** 供测试重置缓存 */
export function clearSessionCache(): void {
	fileCache.clear();
}
