/**
 * 「有任务在跑时先确认」的统一入口。
 *
 * 会重启后端的操作(密钥/模型/MCP/路径变更)都必须先走这里:
 * 之前路径变更那条路径漏了确认,保存会直接杀掉正在跑的任务。
 *
 * 用应用内确认弹窗(而不是 window.confirm):样式跟随主题,且危险操作能给出红色语义。
 */
import { useSessionStore } from "./useSessionStore";
import { confirmAction } from "./confirm";

/** 是否有工作区正在执行任务 */
export function isAnyBusy(): boolean {
	return Object.values(useSessionStore.getState().byCwd).some((ws) => ws.isStreaming);
}

/** 会重启全部后端进程?是则确认。返回 false 表示用户取消 */
export async function confirmRestartIfBusy(action = "保存"): Promise<boolean> {
	if (!isAnyBusy()) return true;
	return confirmAction({
		title: `${action}会重启后端`,
		message: "当前有工作区正在运行任务。\n继续将重启全部后端进程,并中断这些正在跑的任务。",
		confirmText: "继续",
		danger: true,
	});
}
