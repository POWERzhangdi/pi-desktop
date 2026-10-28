import { useEffect, useState } from "react";
import { useActiveWs, useSessionStore } from "../store/useSessionStore";
import { APPROVAL_CONFIRM_TITLE } from "../../../shared/ipc";
import Modal from "./Modal";

/**
 * 阻塞式扩展 UI 请求对话框(confirm/select/input/editor)。
 * 显示当前 workspace 桶的队首请求;响应原样通过 sendCommand 发回 extension_ui_response。
 *
 * 命令审批(title="命令审批")用专用布局:
 * - 明确标注"哪个工作区"在请求权限(多工作区下否则无从判断)
 * - 主按钮是"批准"(默认焦点),危险动作"本轮自动批准"降为次要并要求二次确认
 * - Esc / 取消 = 拒绝(安全侧)
 */
export default function ExtensionUiDialog() {
	const req = useActiveWs((s) => s.uiQueue[0]);
	const respondUi = useSessionStore((s) => s.respondUi);
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const wsName = useSessionStore(
		(s) => s.workspaces.find((w) => w.cwd === s.activeCwd)?.name ?? s.activeCwd,
	);
	const [inputValue, setInputValue] = useState("");

	// 新请求出现时重置输入框(input 用 placeholder,editor 用 prefill)
	useEffect(() => {
		if (!req) return;
		if (req.method === "editor") setInputValue(req.prefill ?? "");
		else setInputValue("");
	}, [req?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!req) return null;

	const cancel = () => respondUi(req.id, { cancelled: true });
	const isCmdApproval = req.method === "confirm" && req.title === APPROVAL_CONFIRM_TITLE;
	/** 本轮自动批准:先让主进程记下(顺序不能反,否则后续请求可能漏放行),再回应本次 */
	const approveAll = async () => {
		await window.piApi.setAutoApproveTurn(activeCwd, true).catch(() => {});
		respondUi(req.id, { confirmed: true });
	};

	const ghost = "text-sm text-txt2 border border-sep rounded-lg px-4 py-1.5 hover:text-txt hover:bg-side btn-press";

	return (
		<Modal
			open
			onClose={cancel}
			closeOnBackdrop={false}
			role={isCmdApproval ? "alertdialog" : "dialog"}
			labelledBy="ext-ui-title"
			className={isCmdApproval ? "w-[520px] p-5" : "w-[440px] p-5"}
		>
			{isCmdApproval ? (
				<>
					<div className="text-xs text-warn mb-1">命令审批</div>
					<h3 id="ext-ui-title" className="text-base font-semibold mb-1">
						执行以下命令?
					</h3>
					<div className="text-[11px] text-txt2 mb-3 flex items-center gap-1.5 min-w-0">
						<span className="shrink-0">来自工作区</span>
						<span className="text-txt truncate font-medium">{wsName}</span>
						<span className="truncate opacity-60 font-mono" title={activeCwd}>
							{activeCwd}
						</span>
					</div>
					<pre className="font-mono text-xs bg-[#232326] text-[#e8e8e8] rounded-lg p-3 mb-4 max-h-60 overflow-auto whitespace-pre-wrap break-all">
						{req.message}
					</pre>
					<div className="flex items-center justify-end gap-2">
						<button onClick={() => respondUi(req.id, { confirmed: false })} className={ghost}>
							拒绝
						</button>
						<button
							onClick={() => void approveAll()}
							title="批准本次,且本轮后续危险命令自动放行"
							className="text-sm text-warn border border-orange/40 bg-orange/10 rounded-lg px-3 py-1.5 hover:bg-orange/15 btn-press"
						>
							本轮自动批准
						</button>
						<button
							data-autofocus
							onClick={() => respondUi(req.id, { confirmed: true })}
							className="text-sm bg-accent text-white rounded-lg px-4 py-1.5 hover:opacity-90 btn-press"
						>
							批准
						</button>
					</div>
				</>
			) : (
				<>
					<div className="text-xs text-purple mb-1">扩展请求</div>
					<h3 id="ext-ui-title" className="text-base font-semibold mb-3">
						{req.title}
					</h3>

					{req.method === "confirm" && (
						<>
							{req.message && (
								<p className="text-sm text-txt2 mb-4 whitespace-pre-wrap">{req.message}</p>
							)}
							<div className="flex justify-end gap-2">
								<button onClick={cancel} className={ghost}>
									取消
								</button>
								<button
									data-autofocus
									onClick={() => respondUi(req.id, { confirmed: false })}
									className={ghost}
								>
									否
								</button>
								<button
									onClick={() => respondUi(req.id, { confirmed: true })}
									className="text-sm bg-accent text-white rounded-lg px-4 py-1.5 hover:opacity-90 btn-press"
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
										className="w-full text-left text-sm border border-sep rounded-lg px-3 py-2 hover:bg-accent-soft btn-press"
									>
										{opt}
									</button>
								))}
							</div>
							<div className="flex justify-end">
								<button onClick={cancel} className={ghost}>
									取消
								</button>
							</div>
						</>
					)}

					{(req.method === "input" || req.method === "editor") && (
						<>
							{req.method === "input" ? (
								<input
									data-autofocus
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
									data-autofocus
									value={inputValue}
									onChange={(e) => setInputValue(e.target.value)}
									rows={8}
									className="w-full bg-ground border border-sep rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent mb-4 resize-y"
								/>
							)}
							<div className="flex justify-end gap-2">
								<button onClick={cancel} className={ghost}>
									取消
								</button>
								<button
									onClick={() => respondUi(req.id, { value: inputValue })}
									className="text-sm bg-accent text-white rounded-lg px-4 py-1.5 hover:opacity-90 btn-press"
								>
									提交
								</button>
							</div>
						</>
					)}
				</>
			)}
		</Modal>
	);
}
