import { useEffect, useState } from "react";
import { useActiveBackend, useActiveWs, useSessionStore } from "./store/useSessionStore";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import MessageList from "./components/MessageList";
import Composer from "./components/Composer";
import ExtensionUiDialog from "./components/ExtensionUiDialog";
import ModelManagerPage from "./components/ModelManagerPage";
import ToastStack from "./components/Toast";

/** 后端崩溃横幅 + 重连 + 打开设置(针对当前 workspace) */
function CrashBanner() {
	const detail = useActiveBackend().detail;
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const pushToast = useSessionStore((s) => s.pushToast);
	const setEnvOpen = useSessionStore((s) => s.setEnvSettingsOpen);
	const reconnect = async () => {
		try {
			// send 时客户端检测到进程已死会自动重启
			await window.piApi.sendCommand(activeCwd, { type: "get_state" });
		} catch (err) {
			pushToast(`重连失败:${(err as Error).message}`, "error");
		}
	};
	return (
		<div className="bg-red/10 border-b border-red text-red px-4 py-2 text-sm flex items-center gap-3">
			<span className="font-medium shrink-0">pi 后端已崩溃</span>
			{detail && (
				<details className="flex-1 min-w-0 text-xs opacity-80">
					<summary className="cursor-pointer truncate">详情</summary>
					<pre className="whitespace-pre-wrap mt-1 max-h-32 overflow-auto">{detail}</pre>
				</details>
			)}
			<button
				onClick={() => setEnvOpen(true)}
				className="shrink-0 bg-side text-red rounded-lg px-3 py-1 text-xs hover:opacity-90"
			>
				打开设置
			</button>
			<button
				onClick={reconnect}
				className="ml-auto shrink-0 bg-red text-white rounded-lg px-3 py-1 text-xs hover:opacity-90"
			>
				重连
			</button>
		</div>
	);
}

/** 环境缺失横幅:pi/Node 未找到时提示打开设置(首启引导) */
function EnvBanner() {
	const setEnvOpen = useSessionStore((s) => s.setEnvSettingsOpen);
	const [envMissing, setEnvMissing] = useState(false);
	useEffect(() => {
		void (async () => {
			try {
				const cfg = await window.piApi.getConfig();
				const rt = cfg.runtimeInfo;
				setEnvMissing(!!rt && (rt.cli.source === "missing" || rt.node.source === "missing"));
			} catch {
				setEnvMissing(false);
			}
		})();
	}, []);
	if (!envMissing) return null;
	return (
		<div className="bg-orange/10 border-b border-orange text-orange px-4 py-2 text-sm flex items-center gap-3">
			<span className="font-medium shrink-0">未检测到 pi 运行环境</span>
			<span className="text-xs opacity-80 flex-1 min-w-0 truncate">
				可打开设置配置 pi / Node 路径,或安装后重启应用
			</span>
			<button
				onClick={() => setEnvOpen(true)}
				className="ml-auto shrink-0 bg-accent text-white rounded-lg px-3 py-1 text-xs hover:opacity-90"
			>
				打开设置
			</button>
		</div>
	);
}

/** 未配置模型横幅:当前模型为占位(pi 返回 id="unknown")时引导去配置 */
function ModelBanner() {
	const sessionState = useActiveWs((s) => s.sessionState);
	const setModelManagerOpen = useSessionStore((s) => s.setModelManagerOpen);
	// sessionState 为 null 时是启动加载中,不显示;占位模型视为未配置
	const noModel = sessionState !== null && (!sessionState.model || sessionState.model.id === "unknown");
	if (!noModel) return null;
	return (
		<div className="bg-orange/10 border-b border-orange text-orange px-4 py-2 text-sm flex items-center gap-3">
			<span className="font-medium shrink-0">尚未配置模型</span>
			<span className="text-xs opacity-80 flex-1 min-w-0 truncate">配置 API Key 后即可开始对话</span>
			<button
				onClick={() => setModelManagerOpen(true)}
				className="ml-auto shrink-0 bg-accent text-white rounded-lg px-3 py-1 text-xs hover:opacity-90"
			>
				配置模型
			</button>
		</div>
	);
}

export default function App() {
	const backendState = useActiveBackend().state;

	// 订阅事件流与后端状态,然后初始化(配置 → workspace 列表 → 激活)
	useEffect(() => {
		const offEvent = window.piApi.onRpcEvent((env) => useSessionStore.getState().handleEnvelope(env));
		const offStatus = window.piApi.onBackendStatus((env) =>
			useSessionStore.getState().handleStatusEnvelope(env),
		);
		void useSessionStore.getState().init();
		return () => {
			offEvent();
			offStatus();
		};
	}, []);

	return (
		<div className="flex h-full bg-ground text-txt overflow-hidden">
			<Sidebar />
			<main className="flex-1 flex flex-col min-w-0">
				<EnvBanner />
				<ModelBanner />
				{backendState === "crashed" && <CrashBanner />}
				<StatusBar />
				<MessageList />
				<Composer />
			</main>
			<ExtensionUiDialog />
			<ModelManagerPage />
			<ToastStack />
		</div>
	);
}
