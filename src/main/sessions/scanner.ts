/**
 * 会话文件扫描器:RPC 协议没有"列出会话"命令,这里直接扫描
 * %USERPROFILE%\.pi\agent\sessions\<转义cwd>\*.jsonl。
 *
 * 文件格式:首行 header {"type":"session","id","timestamp","cwd"},
 * 后续每行一个 entry,取第一条 role:"user" 的 message 文本截 60 字当标题。
 */
import { readdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionSummary } from "../../shared/ipc";

/** 单文件最多读取的字节数(标题通常在文件开头) */
const READ_WINDOW = 64 * 1024;
const TITLE_MAX = 60;

/** 从 user 消息 content 提取纯文本(string 或 blocks 数组) */
function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(b): b is { type: string; text: string } =>
					typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
			)
			.map((b) => b.text)
			.join(" ");
	}
	return "";
}

function makeTitle(text: string): string {
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
					title = makeTitle(extractText(entry.message.content));
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

/** 扫描 sessionsDir 下所有子目录的 *.jsonl,按 mtime 倒序;目录不存在返回 [] */
export async function scanSessions(sessionsDir: string): Promise<SessionSummary[]> {
	let subdirs: string[];
	try {
		const entries = await readdir(sessionsDir, { withFileTypes: true });
		subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}

	const results: SessionSummary[] = [];
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
				const summary = await parseSessionFile(filePath, st.mtimeMs);
				if (summary) results.push(summary);
			} catch {
				// 单文件失败跳过
			}
		}
	}

	results.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return results;
}
