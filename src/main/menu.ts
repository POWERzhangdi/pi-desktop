/**
 * 应用菜单(中文)。
 *
 * 之前没有任何自定义菜单:按 Alt 会弹出 Electron 默认的英文菜单
 * (File / Edit / View / Window / Help),里面带 Reload 和 DevTools,
 * 既不可本地化,也会让用户误触重载丢状态。
 *
 * 菜单项不直接操作渲染进程,统一通过 app:command 发动作,
 * 由渲染端用 store 处理(缩放/主题也因此只有一份状态)。
 */
import { app, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import type { AppCommand } from "../shared/ipc";

export function buildAppMenu(send: (cmd: AppCommand) => void): void {
	const isDev = !!process.env.ELECTRON_RENDERER_URL;

	const about = (): void => {
		void dialog.showMessageBox({
			type: "info",
			title: "关于 pi desktop",
			message: `pi desktop ${app.getVersion()}`,
			detail: `pi 编码 agent 的桌面客户端。\nElectron ${process.versions.electron} · Node ${process.versions.node}`,
			buttons: ["好"],
			noLink: true,
		});
	};

	const template: MenuItemConstructorOptions[] = [
		{
			label: "文件",
			submenu: [
				{ label: "新建会话", accelerator: "CmdOrCtrl+N", click: () => send("session:new") },
				{ label: "添加工作区…", accelerator: "CmdOrCtrl+O", click: () => send("workspace:add") },
				{ type: "separator" },
				{ label: "设置…", accelerator: "CmdOrCtrl+,", click: () => send("settings:open") },
				{ label: "模型与密钥…", click: () => send("models:open") },
				{ type: "separator" },
				{ label: "关闭窗口", accelerator: "CmdOrCtrl+W", role: "close" },
				{ label: "退出", accelerator: "CmdOrCtrl+Q", role: "quit" },
			],
		},
		{
			label: "编辑",
			submenu: [
				{ label: "撤销", role: "undo" },
				{ label: "重做", role: "redo" },
				{ type: "separator" },
				{ label: "剪切", role: "cut" },
				{ label: "复制", role: "copy" },
				{ label: "粘贴", role: "paste" },
				{ type: "separator" },
				{ label: "全选", role: "selectAll" },
			],
		},
		{
			label: "视图",
			submenu: [
				{ label: "放大", accelerator: "CmdOrCtrl+=", click: () => send("zoom:in") },
				{ label: "缩小", accelerator: "CmdOrCtrl+-", click: () => send("zoom:out") },
				{ label: "重置缩放", accelerator: "CmdOrCtrl+0", click: () => send("zoom:reset") },
				{ type: "separator" },
				{ label: "切换深浅色", accelerator: "CmdOrCtrl+Shift+L", click: () => send("theme:toggle") },
				{ type: "separator" },
				{ label: "全屏", role: "togglefullscreen" },
				...(isDev
					? [
							{ type: "separator" as const },
							{ label: "开发者工具", role: "toggleDevTools" as const },
							{ label: "重新加载", role: "reload" as const },
						]
					: []),
			],
		},
		{
			label: "窗口",
			submenu: [
				{ label: "最小化", role: "minimize" },
				{ label: "缩放", role: "zoom" },
			],
		},
		{
			label: "帮助",
			submenu: [{ label: "关于 pi desktop", click: about }],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
