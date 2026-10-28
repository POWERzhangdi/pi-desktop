/**
 * JSON 文件读写工具。
 *
 * 写:先写同目录临时文件再 rename —— 避免进程被杀/断电时留下半截 JSON,
 * 也避免并发读到写了一半的内容(Windows 上 rename 会覆盖目标,语义一致)。
 * 读:任何异常(不存在/权限/半截 JSON)一律回退到默认值,调用方不需要 try。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 原子写 JSON(0600 可选,用于含密钥的文件) */
export function writeJsonAtomic(file: string, value: unknown, opts: { mode?: number } = {}): void {
	const dir = dirname(file);
	mkdirSync(dir, { recursive: true });
	const tmp = join(dir, `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
	try {
		writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: opts.mode });
		renameSync(tmp, file);
	} catch (err) {
		try {
			rmSync(tmp, { force: true });
		} catch {
			/* 清理失败不影响错误上抛 */
		}
		throw err;
	}
}

/** 读 JSON;失败/类型不符(含数组)回退默认值 */
export function readJsonFile<T>(file: string, fallback: T): T {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
		return parsed as T;
	} catch {
		return fallback;
	}
}
