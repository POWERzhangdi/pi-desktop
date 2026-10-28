/**
 * 文本提取:pi 的消息内容可以是纯字符串,也可以是 [{type:"text",text}] 块数组。
 * 主进程(会话扫描)与渲染进程(hydrate/事件归并)都要用,收敛到 shared 一份。
 */
export function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(b): b is { type: string; text: string } =>
					typeof b === "object" && b !== null && (b as { type?: string }).type === "text",
			)
			.map((b) => b.text)
			.join("");
	}
	return "";
}
