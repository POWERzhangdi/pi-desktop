import { useEffect, useState } from "react";
import { useActiveWs, useSessionStore } from "../store/useSessionStore";

/**
 * 阻塞式扩展 UI 请求对话框(confirm/select/input/editor)。
 * 显示当前 workspace 桶的队首请求;响应原样通过 sendCommand 发回 extension_ui_response。
 * 命令审批(title="命令审批")用专用布局:命令 mono 块 + 拒绝/批准/本轮自动批准。
 */
export default function ExtensionUiDialog() {
	const req = useActiveWs((s) => s.uiQueue[0]);
	const respondUi = useSessionStore((s) => s.respondUi);
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const setAutoApproveTurn = useSessionStore((s) => s.setAutoApproveTurn);
	const [inputValue, setInputValue] = useState("");

	// 新请求出现时重置输入框(input 用 placeholder,editor 用 prefill)
	useEffect(() => {
		if (!req) return;
		if (req.method === "editor") setInputValue(req.prefill ?? "");
		else setInputValue("");
	}, [req?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!req) return null;

	const cancel = () => respondUi(req.id, { cancelled: true });
	const isCmdApproval = req.method === "confirm" && req.title === "命令审批";
	const approveAll = () => {
		setAutoApproveTurn(activeCwd, true);
		respondUi(req.id, { confirmed: true });
	};

	return (
		<div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-6">
			<div
				className={`bg-card border border-sep rounded-2xl shadow-2xl max-w-full p-5 ${
					isCmdApproval ? "w-[520px]" : "w-[440px]"
				}`}
			>
				{isCmdApproval ? (
					<>
						<div className="text-xs text-orange mb-1">命令审批</div>
						<h3 className="text-base font-semibold mb-3">执行以下命令?</h3>
						<pre className="font-mono text-xs bg-[#232326] text-[#e8e8e8] rounded-lg p-3 mb-4 max-h-60 overflow-auto whitespace-pre-wrap break-all">
							{req.message}
						</pre>
						<div className="flex justify-end gap-2">
							<button
								onClick={() => respondUi(req.id, { confirmed: false })}
								className="text-sm text-txt2 border border-sep rounded-lg px-3 py-1.5 hover:text-txt"
							>
								拒绝
							</button>
							<button
								onClick={() => respondUi(req.id, { confirmed: true })}
								className="text-sm border border-sep rounded-lg px-3 py-1.5 hover:bg-side"
							>
								批准
							</button>
							<button
								onClick={approveAll}
								title="批准本次,且本轮后续危险命令自动放行"
								className="text-sm bg-accent text-white rounded-lg px-3 py-1.5 hover:opacity-90"
							>
								本轮自动批准
							</button>
						</div>
					</>
				) : (
					<>
						<div className="text-xs text-purple mb-1">扩展请求</div>
						<h3 className="text-base font-semibold mb-3">{req.title}</h3>

						{req.method === "confirm" && (
							<>
								{req.message && (
									<p className="text-sm text-txt2 mb-4 whitespace-pre-wrap">{req.message}</p>
								)}
								<div className="flex justify-end gap-2">
									<button
										onClick={cancel}
										className="text-sm text-txt2 border border-sep rounded-lg px-4 py-1.5 hover:text-txt"
									>
										取消
									</button>
									<button
										onClick={() => respondUi(req.id, { confirmed: false })}
										className="text-sm border border-sep rounded-lg px-4 py-1.5 hover:bg-side"
									>
										否
									</button>
									<button
										onClick={() => respondUi(req.id, { confirmed: true })}
										className="text-sm bg-accent text-white rounded-lg px-4 py-1.5 hover:opacity-90"
									>
										确认
									</button>
								</div>
							</>
						)}

						{req.method === "select" && (
							<>
								<div className="space-y-1.5 mb-4 max-h-64 overflow-y-auto">
									{(req.options ?? []).map((opt) => (
										<button
											key={opt}
											onClick={() => respondUi(req.id, { value: opt })}
											className="w-full text-left text-sm border border-sep rounded-lg px-3 py-2 hover:bg-accent-soft"
										>
											{opt}
										</button>
									))}
								</div>
								<div className="flex justify-end">
									<button
										onClick={cancel}
										className="text-sm text-txt2 border border-sep rounded-lg px-4 py-1.5 hover:text-txt"
									>
										取消
									</button>
								</div>
							</>
						)}

						{(req.method === "input" || req.method === "editor") && (
							<>
								{req.method === "input" ? (
									<input
										autoFocus
										value={inputValue}
										onChange={(e) => setInputValue(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") respondUi(req.id, { value: inputValue });
										}}
										placeholder={req.placeholder}
										className="w-full bg-ground border border-sep rounded-lg px-3 py-2 text-sm outline-none focus:border-accent mb-4"
									/>
								) : (
									<textarea
										autoFocus
										value={inputValue}
										onChange={(e) => setInputValue(e.target.value)}
										rows={8}
										className="w-full bg-ground border border-sep rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent mb-4 resize-y"
									/>
								)}
								<div className="flex justify-end gap-2">
									<button
										onClick={cancel}
										className="text-sm text-txt2 border border-sep rounded-lg px-4 py-1.5 hover:text-txt"
									>
										取消
									</button>
									<button
										onClick={() => respondUi(req.id, { value: inputValue })}
										className="text-sm bg-accent text-white rounded-lg px-4 py-1.5 hover:opacity-90"
									>
										提交
									</button>
								</div>
							</>
						)}
					</>
				)}
			</div>
		</div>
	);
}
