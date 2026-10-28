/**
 * 外链打开:只允许 http(s)。用于渲染进程发起的链接与页面导航兜底,
 * 防止 javascript:/file:/ms-… 等协议被用来执行代码或读本地文件。
 */
import { shell } from "electron";

export function openExternalSafely(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
	void shell.openExternal(parsed.toString());
}
