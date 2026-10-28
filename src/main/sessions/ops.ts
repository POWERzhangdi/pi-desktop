/**
 * 会话文件操作。
 *
 * 渲染进程传来的 filePath 不可信(渲染进程与模型输出同域),这里必须校验:
 * 只允许操作 sessionsDir 下的 *.jsonl,防止路径穿越删掉任意文件。
 */
import { isAbsolute, relative, resolve } from "node:path";
import { rename, unlink } from "node:fs/promises";

/** 校验并归一化路径;越界/类型不符直接抛错 */
export function assertSessionFile(sessionsDir: string, filePath: string): string {
	const root = resolve(sessionsDir);
	const abs = resolve(filePath);
	const rel = relative(root, abs);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error("路径不在会话目录内");
	}
	if (!abs.endsWith(".jsonl")) {
		throw new Error("只能操作 .jsonl 会话文件");
	}
	return abs;
}

/** 删除会话文件;失败返回 false(调用方负责提示) */
export async function deleteSessionFile(sessionsDir: string, filePath: string): Promise<boolean> {
	try {
		await unlink(assertSessionFile(sessionsDir, filePath));
		return true;
	} catch (err) {
		console.error("[sessions] 删除失败:", err);
		return false;
	}
}

/** 归档会话:重命名加 .archived 后缀(文件保留) */
export async function archiveSessionFile(sessionsDir: string, filePath: string): Promise<boolean> {
	try {
		const abs = assertSessionFile(sessionsDir, filePath);
		await rename(abs, `${abs}.archived`);
		return true;
	} catch (err) {
		console.error("[sessions] 归档失败:", err);
		return false;
	}
}
