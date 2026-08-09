import { useEffect } from "react";
import { useActiveBackend, useSessionStore } from "./store/useSessionStore";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import MessageList from "./components/MessageList";
import Composer from "./components/Composer";
import ExtensionUiDialog from "./components/ExtensionUiDialog";
import ModelManagerPage from "./components/ModelManagerPage";
import ToastStack from "./components/Toast";

/** 后端崩溃横幅 + 重连(针对当前 workspace) */
function CrashBanner() {
	const detail = useActiveBackend().detail;
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const pushToast = useSessionStore((s) => s.pushToast);
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
				onClick={reconnect}
				className="ml-auto shrink-0 bg-red text-white rounded-lg px-3 py-1 text-xs hover:opacity-90"
			>
				重连
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
