/**
 * 会话状态 store(多 workspace 版):
 * UI 状态按 cwd 分桶(byCwd),事件以 {cwd, evt} 信封路由到对应桶;
 * activeCwd 驱动组件显示;后台 workspace 的完成/确认请求转 toast。
 */
import { create } from "zustand";
import { loadModelPrefs } from "./modelPrefs";
import { contentToText } from "../../../shared/text";
import type {
	AgentMessage,
	AssistantMessage,
	CommandInfo,
	ImageContent,
	Model,
	RpcSessionState,
	SessionEntry,
	SessionStats,
	ThinkingLevel,
	ToolResultMessage,
	UserMessage,
} from "../../../shared/rpc-types";
import type {
	ApprovalMode,
	BackendStatus,
	BackendStatusEnvelope,
	RpcEventEnvelope,
	SessionSummary,
	WorkspaceInfo,
} from "../../../shared/ipc";

/* ---------------- 视图模型 ---------------- */

export interface ToolCallView {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** 流式部分输出(累计文本) */
	partialText?: string;
	/** 最终结果文本 */
	resultText?: string;
	/** 结果 details(宽松保留,可能含 exitCode 等) */
	resultDetails?: unknown;
	isError?: boolean;
	status: "running" | "done" | "error";
}

export type BlockView =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "toolCall"; toolCallId: string };

export interface BashView {
	command: string;
	output: string;
	exitCode?: number;
	cancelled?: boolean;
	truncated?: boolean;
}

export interface MessageView {
	id: string;
	role: "user" | "assistant" | "bashExecution" | "custom" | "system";
	/** user/custom/system 的纯文本 */
	text?: string;
	/** assistant 的有序内容块 */
	blocks: BlockView[];
	/** assistant 的工具调用 */
	toolCalls: ToolCallView[];
	bash?: BashView;
	errorMessage?: string;
	timestamp?: number;
}

export type ToastKind = "info" | "warning" | "error";
export interface ToastItem {
	id: number;
	message: string;
	kind: ToastKind;
	/** 点击"前往"时切换到的 workspace */
	actionCwd?: string;
}

/** 阻塞式扩展 UI 请求(confirm/select/input/editor) */
export interface UiDialogRequest {
	id: string;
	method: "confirm" | "select" | "input" | "editor";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
}

/** 单个 workspace 的全部 UI 状态 */
export interface WorkspaceViewState {
	messages: MessageView[];
	isStreaming: boolean;
	pendingCount: number;
	uiQueue: UiDialogRequest[];
	/** 扩展 setStatus 内容(statusKey → 文本) */
	statusEntries: Record<string, string>;
	sessionState: RpcSessionState | null;
	stats: SessionStats | null;
	activeSessionFile?: string;
}

function emptyWs(): WorkspaceViewState {
	return {
		messages: [],
		isStreaming: false,
		pendingCount: 0,
		uiQueue: [],
		statusEntries: {},
		sessionState: null,
		stats: null,
		activeSessionFile: undefined,
	};
}

/** 选择器兜底(引用稳定,避免无谓重渲染) */
const EMPTY_WS = emptyWs();
const DEFAULT_BACKEND: BackendStatus = { state: "starting" };

/* ---------------- 工具函数 ---------------- */

let msgSeq = 0;
function nextMsgId(): string {
	return `m-${Date.now()}-${++msgSeq}`;
}

let toastSeq = 0;


/** 从工具结果载荷提取文本 */
function payloadToText(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	return contentToText((payload as { content?: unknown }).content);
}

/* ---------------- 单桶 reducer(纯函数) ---------------- */

interface ToastReq {
	message: string;
	kind: ToastKind;
}

/** 找到(或创建)最后一条 assistant 消息,返回其下标 */
function ensureLastAssistant(messages: MessageView[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") return i;
	}
	messages.push({ id: nextMsgId(), role: "assistant", blocks: [], toolCalls: [] });
	return messages.length - 1;
}

/** 按 toolCallId 查找工具调用(从后往前) */
function findToolCall(
	messages: MessageView[],
	toolCallId: string,
): { msg: MessageView; call: ToolCallView } | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const call = messages[i].toolCalls.find((c) => c.toolCallId === toolCallId);
		if (call) return { msg: messages[i], call };
	}
	return null;
}

/** 向最后一条 assistant 追加文本 delta */
function appendDelta(messages: MessageView[], kind: "text" | "thinking", delta: string): MessageView[] {
	const next = [...messages];
	const idx = ensureLastAssistant(next);
	const msg = { ...next[idx], blocks: [...next[idx].blocks] };
	const last = msg.blocks[msg.blocks.length - 1];
	if (last && last.kind === kind) {
		msg.blocks[msg.blocks.length - 1] = { ...last, text: last.text + delta };
	} else {
		msg.blocks.push({ kind, text: delta });
	}
	next[idx] = msg;
	return next;
}

function updateToolCall(
	messages: MessageView[],
	toolCallId: string,
	patch: Partial<ToolCallView>,
): MessageView[] {
	const next = [...messages];
	const found = findToolCall(next, toolCallId);
	if (found) {
		Object.assign(found.call, patch);
		return next;
	}
	// 没找到:挂到最后一条 assistant(容错)
	const idx = ensureLastAssistant(next);
	const msg = { ...next[idx], toolCalls: [...next[idx].toolCalls] };
	msg.toolCalls.push({ toolCallId, toolName: "unknown", args: {}, status: "running", ...patch });
	next[idx] = msg;
	return next;
}

/** 消息事件(message_start / message_end) */
function reduceMessageEvent(
	ws: WorkspaceViewState,
	evt: Record<string, unknown>,
	isEnd: boolean,
): { ws: WorkspaceViewState; toasts: ToastReq[] } {
	const m = evt.message as AgentMessage | undefined;
	if (!m || typeof m !== "object") return { ws, toasts: [] };

	if (m.role === "user") {
		if (isEnd) return { ws, toasts: [] };
		const text = contentToText((m as UserMessage).content);
		return {
			ws: {
				...ws,
				messages: [...ws.messages, { id: nextMsgId(), role: "user", text, blocks: [], toolCalls: [] }],
			},
			toasts: [],
		};
	}

	if (m.role === "assistant") {
		const am = m as AssistantMessage;
		if (!isEnd) {
			return {
				ws: {
					...ws,
					messages: [...ws.messages, { id: nextMsgId(), role: "assistant", blocks: [], toolCalls: [] }],
				},
				toasts: [],
			};
		}
		// message_end:用最终消息重建块,修正流式误差;保留已有工具调用状态
		const messages = [...ws.messages];
		const idx = ensureLastAssistant(messages);
		const prev = messages[idx];
		const blocks: BlockView[] = [];
		const toolCalls: ToolCallView[] = [];
		for (const block of am.content || []) {
			if (block.type === "text") {
				const lastBlock = blocks[blocks.length - 1];
				if (lastBlock && lastBlock.kind === "text") lastBlock.text += block.text;
				else blocks.push({ kind: "text", text: block.text });
			} else if (block.type === "thinking") {
				blocks.push({ kind: "thinking", text: block.thinking });
			} else if (block.type === "toolCall") {
				blocks.push({ kind: "toolCall", toolCallId: block.id });
				const existing = prev.toolCalls.find((c) => c.toolCallId === block.id);
				toolCalls.push(
					existing ?? {
						toolCallId: block.id,
						toolName: block.name,
						args: (block.arguments as Record<string, unknown>) ?? {},
						status: "running",
					},
				);
			}
		}
		messages[idx] = {
			...prev,
			blocks: blocks.length > 0 ? blocks : prev.blocks,
			toolCalls: toolCalls.length > 0 ? toolCalls : prev.toolCalls,
			errorMessage: am.errorMessage,
		};
		const toasts: ToastReq[] = am.errorMessage
			? [{ message: `模型错误:${am.errorMessage}`, kind: "error" }]
			: [];
		return { ws: { ...ws, messages }, toasts };
	}

	if (m.role === "bashExecution" && !isEnd) {
		const bm = m as {
			command?: string;
			output?: string;
			exitCode?: number;
			cancelled?: boolean;
			truncated?: boolean;
		};
		return {
			ws: {
				...ws,
				messages: [
					...ws.messages,
					{
						id: nextMsgId(),
						role: "bashExecution",
						blocks: [],
						toolCalls: [],
						bash: {
							command: bm.command ?? "",
							output: bm.output ?? "",
							exitCode: bm.exitCode,
							cancelled: bm.cancelled,
							truncated: bm.truncated,
						},
					},
				],
			},
			toasts: [],
		};
	}

	if (m.role === "custom" && !isEnd) {
		const cm = m as { content?: unknown; display?: boolean };
		if (cm.display === false) return { ws, toasts: [] };
		return {
			ws: {
				...ws,
				messages: [
					...ws.messages,
					{ id: nextMsgId(), role: "custom", text: contentToText(cm.content), blocks: [], toolCalls: [] },
				],
			},
			toasts: [],
		};
	}

	if ((m.role === "compactionSummary" || m.role === "branchSummary") && !isEnd) {
		const sm = m as { summary?: string };
		return {
			ws: {
				...ws,
				messages: [
					...ws.messages,
					{
						id: nextMsgId(),
						role: "system",
						text:
							m.role === "compactionSummary"
								? `上下文压缩摘要:${sm.summary ?? ""}`
								: `分支摘要:${sm.summary ?? ""}`,
						blocks: [],
						toolCalls: [],
					},
				],
			},
			toasts: [],
		};
	}
	// toolResult 不入消息流(结果由 tool_execution_end 归并到工具卡片)
	return { ws, toasts: [] };
}

/** 扩展 UI 请求分发 */
function reduceUiRequest(
	ws: WorkspaceViewState,
	evt: Record<string, unknown>,
): { ws: WorkspaceViewState; toasts: ToastReq[] } {
	const method = evt.method as string;
	const id = evt.id as string;
	if (method === "notify") {
		return { ws, toasts: [{ message: String(evt.message ?? ""), kind: (evt.notifyType as ToastKind) ?? "info" }] };
	}
	if (method === "setStatus") {
		const statusEntries = { ...ws.statusEntries };
		const key = String(evt.statusKey ?? "");
		const text = evt.statusText as string | undefined;
		if (text === undefined || text === "") delete statusEntries[key];
		else statusEntries[key] = text;
		return { ws: { ...ws, statusEntries }, toasts: [] };
	}
	if (method === "confirm" || method === "select" || method === "input" || method === "editor") {
		const req: UiDialogRequest = {
			id,
			method,
			title: String(evt.title ?? ""),
			message: evt.message as string | undefined,
			options: evt.options as string[] | undefined,
			placeholder: evt.placeholder as string | undefined,
			prefill: evt.prefill as string | undefined,
		};
		return { ws: { ...ws, uiQueue: [...ws.uiQueue, req] }, toasts: [] };
	}
	// setWidget / setTitle / set_editor_text 等即发即弃请求忽略
	return { ws, toasts: [] };
}

/** 单桶事件归并:返回新桶与 toast 副作用 */
function reduceEvent(
	ws: WorkspaceViewState,
	evt: Record<string, unknown>,
): { ws: WorkspaceViewState; toasts: ToastReq[] } {
	const type = evt.type as string;
	switch (type) {
		case "message_start":
			return reduceMessageEvent(ws, evt, false);
		case "message_end":
			return reduceMessageEvent(ws, evt, true);
		case "message_update": {
			const ame = evt.assistantMessageEvent as
				| { type?: string; delta?: string; toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> } }
				| undefined;
			if (!ame) return { ws, toasts: [] };
			if (ame.type === "text_delta" && typeof ame.delta === "string") {
				return { ws: { ...ws, messages: appendDelta(ws.messages, "text", ame.delta) }, toasts: [] };
			}
			if (ame.type === "thinking_delta" && typeof ame.delta === "string") {
				return { ws: { ...ws, messages: appendDelta(ws.messages, "thinking", ame.delta) }, toasts: [] };
			}
			if (ame.type === "toolcall_end" && ame.toolCall?.id) {
				const tc = ame.toolCall;
				const messages = [...ws.messages];
				const idx = ensureLastAssistant(messages);
				const msg = { ...messages[idx], blocks: [...messages[idx].blocks], toolCalls: [...messages[idx].toolCalls] };
				if (!msg.toolCalls.some((c) => c.toolCallId === tc.id)) {
					msg.blocks.push({ kind: "toolCall", toolCallId: tc.id! });
					msg.toolCalls.push({
						toolCallId: tc.id!,
						toolName: tc.name ?? "unknown",
						args: tc.arguments ?? {},
						status: "running",
					});
				}
				messages[idx] = msg;
				return { ws: { ...ws, messages }, toasts: [] };
			}
			if (ame.type === "error") {
				const errMsg = (ame as { errorMessage?: string }).errorMessage;
				if (errMsg) return { ws, toasts: [{ message: `流式错误:${errMsg}`, kind: "error" }] };
			}
			return { ws, toasts: [] };
		}
		case "tool_execution_start":
			return {
				ws: {
					...ws,
					messages: updateToolCall(ws.messages, String(evt.toolCallId ?? ""), {
						toolName: String(evt.toolName ?? "unknown"),
						args: (evt.args as Record<string, unknown>) ?? {},
						status: "running",
					}),
				},
				toasts: [],
			};
		case "tool_execution_update": {
			const text = payloadToText(evt.partialResult);
			if (!text) return { ws, toasts: [] };
			return {
				ws: { ...ws, messages: updateToolCall(ws.messages, String(evt.toolCallId ?? ""), { partialText: text }) },
				toasts: [],
			};
		}
		case "tool_execution_end": {
			const isError = Boolean(evt.isError);
			return {
				ws: {
					...ws,
					messages: updateToolCall(ws.messages, String(evt.toolCallId ?? ""), {
						resultText: payloadToText(evt.result),
						resultDetails: (evt.result as { details?: unknown } | undefined)?.details,
						isError,
						status: isError ? "error" : "done",
					}),
				},
				toasts: [],
			};
		}
		case "agent_start":
			return { ws: { ...ws, isStreaming: true }, toasts: [] };
		case "agent_end":
		case "agent_settled":
			return { ws: { ...ws, isStreaming: false }, toasts: [] };
		case "queue_update": {
			const steering = (evt.steering as string[]) ?? [];
			const followUp = (evt.followUp as string[]) ?? [];
			return { ws: { ...ws, pendingCount: steering.length + followUp.length }, toasts: [] };
		}
		case "compaction_start":
			return {
				ws: { ...ws, statusEntries: { ...ws.statusEntries, compaction: "正在压缩上下文…" } },
				toasts: [],
			};
		case "compaction_end": {
			const statusEntries = { ...ws.statusEntries };
			delete statusEntries.compaction;
			const errMsg = evt.errorMessage as string | undefined;
			// pi 在会话过短时抛 "Nothing to compact" —— 不是失败,是无需压缩
			const nothingToCompact = !!errMsg && /nothing to compact/i.test(errMsg);
			const toasts: ToastReq[] = nothingToCompact
				? [{ message: "上下文太少,无需压缩", kind: "info" }]
				: errMsg
					? [{ message: `上下文压缩失败:${errMsg}`, kind: "error" }]
					: !evt.aborted
						? [{ message: "上下文压缩完成", kind: "info" }]
						: [];
			return { ws: { ...ws, statusEntries }, toasts };
		}
		case "auto_retry_start":
			return {
				ws: {
					...ws,
					// 重试期间 agent 实际仍在运行,保持流式状态(发送键保持为停止)
					isStreaming: true,
					statusEntries: {
						...ws.statusEntries,
						retry: `自动重试 ${evt.attempt ?? "?"}/${evt.maxAttempts ?? "?"}…`,
					},
				},
				toasts: [],
			};
		case "auto_retry_end": {
			const statusEntries = { ...ws.statusEntries };
			delete statusEntries.retry;
			const toasts: ToastReq[] =
				evt.success === false ? [{ message: `重试失败:${evt.finalError ?? "未知错误"}`, kind: "error" }] : [];
			return { ws: { ...ws, statusEntries }, toasts };
		}
		case "extension_error":
			return { ws, toasts: [{ message: `扩展错误:${evt.error ?? "未知"}`, kind: "error" }] };
		case "extension_ui_request":
			return reduceUiRequest(ws, evt);
		default:
			// turn_start/turn_end 等事件无需处理
			return { ws, toasts: [] };
	}
}

/** 由历史 entries 重建消息列表(切换会话/恢复 workspace 时) */
function hydrateMessages(entries: SessionEntry[]): MessageView[] {
	const messages: MessageView[] = [];
	const toolIndex = new Map<string, ToolCallView>();
	for (const entry of entries) {
		if (entry.type === "message" && entry.message) {
			const m = entry.message;
			if (m.role === "user") {
				messages.push({
					id: nextMsgId(),
					role: "user",
					text: contentToText((m as UserMessage).content),
					blocks: [],
					toolCalls: [],
				});
			} else if (m.role === "assistant") {
				const am = m as AssistantMessage;
				const view: MessageView = {
					id: nextMsgId(),
					role: "assistant",
					blocks: [],
					toolCalls: [],
					errorMessage: am.errorMessage,
				};
				for (const block of am.content || []) {
					if (block.type === "text") {
						const last = view.blocks[view.blocks.length - 1];
						if (last && last.kind === "text") last.text += block.text;
						else view.blocks.push({ kind: "text", text: block.text });
					} else if (block.type === "thinking") {
						view.blocks.push({ kind: "thinking", text: block.thinking });
					} else if (block.type === "toolCall") {
						view.blocks.push({ kind: "toolCall", toolCallId: block.id });
						const call: ToolCallView = {
							toolCallId: block.id,
							toolName: block.name,
							args: (block.arguments as Record<string, unknown>) ?? {},
							status: "running",
						};
						view.toolCalls.push(call);
						toolIndex.set(block.id, call);
					}
				}
				messages.push(view);
			} else if (m.role === "toolResult") {
				const tr = m as ToolResultMessage;
				const call = toolIndex.get(tr.toolCallId);
				if (call) {
					call.resultText = contentToText(tr.content);
					call.isError = Boolean(tr.isError);
					call.status = tr.isError ? "error" : "done";
				}
			} else if (m.role === "bashExecution") {
				const bm = m as {
					command?: string;
					output?: string;
					exitCode?: number;
					cancelled?: boolean;
					truncated?: boolean;
				};
				messages.push({
					id: nextMsgId(),
					role: "bashExecution",
					blocks: [],
					toolCalls: [],
					bash: {
						command: bm.command ?? "",
						output: bm.output ?? "",
						exitCode: bm.exitCode,
						cancelled: bm.cancelled,
						truncated: bm.truncated,
					},
				});
			} else if (m.role === "custom") {
				const cm = m as { content?: unknown; display?: boolean };
				if (cm.display !== false) {
					messages.push({
						id: nextMsgId(),
						role: "custom",
						text: contentToText(cm.content),
						blocks: [],
						toolCalls: [],
					});
				}
			} else if (m.role === "compactionSummary" || m.role === "branchSummary") {
				const sm = m as { summary?: string };
				messages.push({
					id: nextMsgId(),
					role: "system",
					text:
						m.role === "compactionSummary"
							? `上下文压缩摘要:${sm.summary ?? ""}`
							: `分支摘要:${sm.summary ?? ""}`,
					blocks: [],
					toolCalls: [],
				});
			}
		} else if (entry.type === "compaction") {
			const tokens = (entry as { tokensBefore?: number }).tokensBefore;
			messages.push({
				id: nextMsgId(),
				role: "system",
				text: `—— 上下文已压缩${tokens ? `(压缩前 ${tokens} tokens)` : ""} ——`,
				blocks: [],
				toolCalls: [],
			});
		}
		// 其他 entry 类型(model_change 等)跳过
	}
	return messages;
}

/* ---------------- Store ---------------- */

interface SessionStore {
	activeCwd: string;
	byCwd: Record<string, WorkspaceViewState>;
	backendByCwd: Record<string, BackendStatus>;
	workspaces: WorkspaceInfo[];
	/** 全部 workspace 的会话(组件按 activeCwd 过滤) */
	sessions: SessionSummary[];
	/** 模型/thinking/斜杠命令为进程无关的全局数据,只拉一次 */
	models: Model[];
	thinkingLevels: ThinkingLevel[];
	slashCommands: CommandInfo[];
	globalsLoaded: boolean;
	toasts: ToastItem[];

	/** 应用启动:取配置、workspace/会话列表,确定 activeCwd 并激活 */
	init: () => Promise<void>;
	handleEnvelope: (env: RpcEventEnvelope) => void;
	handleStatusEnvelope: (env: BackendStatusEnvelope) => void;
	/** 切换当前 workspace:建桶、探活(懒启动进程)、按需水合历史 */
	setActive: (cwd: string) => Promise<void>;

	sendPrompt: (text: string, images?: ImageContent[]) => Promise<void>;
	abort: () => Promise<void>;
	/** 重发上一条用户消息(无回退语义,等价于再发一遍) */
	retryLast: () => Promise<void>;
	/** 手动压缩上下文:发 { type: "compact" } RPC;compaction_start/end 事件已由 reduceEvent 归并 */
	compact: () => Promise<void>;
	newSession: () => Promise<void>;
	switchToSession: (filePath: string) => Promise<void>;
	/** 重新拉取当前桶的 state/stats(一轮结束、模型切换后) */
	refreshActive: () => Promise<void>;
	/** 重新拉取 thinking levels(切换模型后可选项会变) */
	reloadThinkingLevels: () => Promise<void>;
	refreshSessions: () => Promise<void>;
	refreshWorkspaces: () => Promise<void>;
	addWorkspace: () => Promise<void>;
	removeWorkspace: (cwd: string) => Promise<void>;
	archiveWorkspace: (cwd: string) => Promise<void>;
	restoreWorkspace: (cwd: string) => Promise<void>;
	/** 平铺列表中各 workspace 的展开状态(默认仅当前项展开) */
	expandedCwds: Record<string, boolean>;
	toggleExpanded: (cwd: string) => void;
	/** 在指定 workspace 新建会话(先激活再建) */
	newSessionIn: (cwd: string) => Promise<void>;
	/** 打开指定 workspace 的某个会话(先激活再切会话,保证上下文隔离) */
	openSession: (cwd: string, filePath: string) => Promise<void>;
	/** 删除会话文件;若为当前会话则切到剩余首个 */
	deleteSession: (filePath: string) => Promise<void>;
	/** 归档会话(移出列表,文件保留 .archived) */
	archiveSession: (filePath: string) => Promise<void>;
	respondUi: (id: string, payload: Record<string, unknown>) => void;
	pushToast: (message: string, kind?: ToastKind, actionCwd?: string) => void;
	dismissToast: (id: number) => void;
	/** 模型管理页(全屏覆盖层)开关 */
	modelManagerOpen: boolean;
	setModelManagerOpen: (open: boolean) => void;
	/** 环境设置弹窗开关(侧边栏设置按钮 + 首启引导横幅共用) */
	envSettingsOpen: boolean;
	setEnvSettingsOpen: (open: boolean) => void;
	/** OCR 引擎:tesseract(默认,纯JS) / rapidocr(强,需 Python+包);持久化 localStorage */
	ocrEngine: "tesseract" | "rapidocr";
	setOcrEngine: (e: "tesseract" | "rapidocr") => void;
	/** 命令审批模式(per-workspace,权威在主进程,这里只是镜像用于展示/切换) */
	approvalModeByCwd: Record<string, ApprovalMode>;
	setApprovalMode: (cwd: string, mode: ApprovalMode) => void;
	/** provider/模型配置变更后:重新拉取可用模型与思考等级,并恢复当前工作区的模型偏好 */
	reloadModels: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>()((set, get) => {
	/** 取桶(不存在则创建) */
	function ensureBucket(cwd: string): void {
		if (!get().byCwd[cwd]) {
			set((s) => ({ byCwd: { ...s.byCwd, [cwd]: emptyWs() } }));
		}
	}

	/** 忘掉一个 workspace 的本地状态(归档/删除后调用) */
	function forget(cwd: string): void {
		set((s) => {
			const byCwd = { ...s.byCwd };
			delete byCwd[cwd];
			const backendByCwd = { ...s.backendByCwd };
			delete backendByCwd[cwd];
			const expandedCwds = { ...s.expandedCwds };
			delete expandedCwds[cwd];
			return { byCwd, backendByCwd, expandedCwds };
		});
	}

	/** 更新指定桶 */
	function patchWs(cwd: string, patch: Partial<WorkspaceViewState>): void {
		set((s) => {
			const ws = s.byCwd[cwd] ?? emptyWs();
			return { byCwd: { ...s.byCwd, [cwd]: { ...ws, ...patch } } };
		});
	}

	function activeWs(): WorkspaceViewState {
		return get().byCwd[get().activeCwd] ?? EMPTY_WS;
	}

	function wsName(cwd: string): string {
		return get().workspaces.find((w) => w.cwd === cwd)?.name ?? cwd;
	}

	/** 拉当前桶的 state/stats(切换激活、一轮结束后) */
	async function refreshActiveState(): Promise<void> {
		const cwd = get().activeCwd;
		try {
			const resp = await window.piApi.sendCommand(cwd, { type: "get_state" });
			const state = resp.data as RpcSessionState;
			patchWs(cwd, {
				sessionState: state,
				activeSessionFile: state.sessionFile,
				isStreaming: state.isStreaming,
			});
			// get_state 成功即后端就绪:重新同步状态(页面重载后 status 事件不会重发 ready)
			set((s) => ({ backendByCwd: { ...s.backendByCwd, [cwd]: { state: "ready" } } }));
		} catch (err) {
			get().pushToast(`获取状态失败:${(err as Error).message}`, "error");
		}
		try {
			const resp = await window.piApi.sendCommand(cwd, { type: "get_session_stats" });
			patchWs(cwd, { stats: resp.data as SessionStats });
		} catch {
			// 统计失败不打扰用户
		}
	}

	/** 全局数据(模型/thinking/斜杠命令),只拉一次 */
	async function loadGlobals(cwd: string): Promise<void> {
		if (get().globalsLoaded) return;
		try {
			const resp = await window.piApi.sendCommand(cwd, { type: "get_available_models" });
			set({ models: (resp.data as { models?: Model[] } | undefined)?.models ?? [] });
		} catch {
			/* 忽略 */
		}
		try {
			const resp = await window.piApi.sendCommand(cwd, { type: "get_available_thinking_levels" });
			const levels = (resp.data as { levels?: ThinkingLevel[] } | undefined)?.levels;
			set({ thinkingLevels: levels && levels.length > 0 ? levels : ["off"] });
		} catch {
			set({ thinkingLevels: ["off", "minimal", "low", "medium", "high"] });
		}
		try {
			const resp = await window.piApi.sendCommand(cwd, { type: "get_commands" });
			set({ slashCommands: (resp.data as { commands?: CommandInfo[] } | undefined)?.commands ?? [] });
		} catch {
			/* 忽略 */
		}
		set({ globalsLoaded: true });
	}

	/** 恢复该 workspace 记住的模型/思考等级(进程懒启动后尤其重要) */
	async function applyModelPref(cwd: string): Promise<void> {
		const pref = loadModelPrefs()[cwd];
		if (!pref) return;
		const cur = get().byCwd[cwd]?.sessionState;
		let changed = false;
		if (
			pref.provider &&
			pref.modelId &&
			(cur?.model?.provider !== pref.provider || cur?.model?.id !== pref.modelId)
		) {
			try {
				await window.piApi.sendCommand(cwd, {
					type: "set_model",
					provider: pref.provider,
					modelId: pref.modelId,
				});
				changed = true;
			} catch {
				// 模型可能已被移除,忽略并用默认
			}
		}
		if (pref.thinkingLevel && cur?.thinkingLevel !== pref.thinkingLevel) {
			try {
				await window.piApi.sendCommand(cwd, { type: "set_thinking_level", level: pref.thinkingLevel });
				changed = true;
			} catch {
				/* 该模型可能不支持此等级,忽略 */
			}
		}
		if (changed) await refreshActiveState();
	}

	/* ---------------- 事件归并(含水合缓冲) ---------------- */

	/** 水合中的 workspace:此时到达的事件先入缓冲,水合完成后再按序回放 */
	const hydrating = new Set<string>();
	const hydrationBuffer = new Map<string, Record<string, unknown>[]>();

	/** 单条事件归并(不含缓冲逻辑) */
	function applyEvent(cwd: string, evt: Record<string, unknown>): void {
		set((s) => {
			const ws = s.byCwd[cwd] ?? emptyWs();
			const { ws: next, toasts } = reduceEvent(ws, evt);
			// toast 副作用在 set 外发
			queueMicrotask(() => {
				for (const t of toasts) get().pushToast(t.message, t.kind);
			});
			return { byCwd: { ...s.byCwd, [cwd]: next } };
		});

		// 后台 workspace 的注意力提示
		if (cwd !== get().activeCwd) {
			if (evt.type === "agent_end") {
				get().pushToast(`「${wsName(cwd)}」任务完成`, "info", cwd);
			} else if (
				evt.type === "extension_ui_request" &&
				["confirm", "select", "input", "editor"].includes(String((evt as { method?: string }).method))
			) {
				get().pushToast(`「${wsName(cwd)}」有一个确认请求`, "warning", cwd);
			}
		}

		// 一轮结束后刷新会话列表(新会话/标题更新)
		if (evt.type === "agent_end") void get().refreshSessions();
		// 压缩结束后刷新统计(环形/占用数据随之更新)
		if (evt.type === "compaction_end") void get().refreshActive();
	}

	/** 水合期间先缓冲,避免 get_entries 整体替换时丢掉刚到的流式增量 */
	function dispatchEvent(cwd: string, evt: Record<string, unknown>): void {
		if (hydrating.has(cwd)) {
			const list = hydrationBuffer.get(cwd) ?? [];
			list.push(evt);
			hydrationBuffer.set(cwd, list);
			return;
		}
		applyEvent(cwd, evt);
	}

	/** 水合结束:回放缓冲事件 */
	function flushHydration(cwd: string): void {
		hydrating.delete(cwd);
		const pending = hydrationBuffer.get(cwd) ?? [];
		hydrationBuffer.delete(cwd);
		for (const evt of pending) applyEvent(cwd, evt);
	}

	return {
		activeCwd: "",
		byCwd: {},
		backendByCwd: {},
		workspaces: [],
		sessions: [],
		models: [],
		thinkingLevels: [],
		slashCommands: [],
		globalsLoaded: false,
		toasts: [],
		expandedCwds: {},
		ocrEngine: localStorage.getItem("ocrEngine") === "rapidocr" ? "rapidocr" : "tesseract",
		approvalModeByCwd: {},

		init: async () => {
			try {
				// 审批模式由主进程持有(安全策略不在渲染进程),启动时同步一次
				try {
					set({ approvalModeByCwd: await window.piApi.getApprovalModes() });
				} catch {
					/* 首次运行可能还没有审批配置 */
				}
				const cfg = await window.piApi.getConfig();
				await get().refreshWorkspaces();
				await get().refreshSessions();
				const stored = localStorage.getItem("pi-desktop-active-ws");
				const wsList = get().workspaces;
				const initial =
					stored && wsList.some((w) => w.cwd === stored) ? stored : (wsList[0]?.cwd ?? cfg.cwd);
				if (initial) await get().setActive(initial);
			} catch (err) {
				get().pushToast(`初始化失败:${(err as Error).message}`, "error");
			}
		},

		handleEnvelope: (env) => {
			dispatchEvent(env.cwd, env.evt);
		},

		handleStatusEnvelope: (env) => {
			set((s) => {
				const backendByCwd = { ...s.backendByCwd, [env.cwd]: env.status };
				if (env.status.state !== "crashed") return { backendByCwd };
				// 进程崩溃:清掉流式标记与待确认队列,否则 UI 会停在"停止/等待审批"
				const ws = s.byCwd[env.cwd];
				if (!ws) return { backendByCwd };
				return {
					backendByCwd,
					byCwd: {
						...s.byCwd,
						[env.cwd]: { ...ws, isStreaming: false, pendingCount: 0, uiQueue: [] },
					},
				};
			});
		},

		setActive: async (cwd) => {
			set({ activeCwd: cwd });
			localStorage.setItem("pi-desktop-active-ws", cwd);
			ensureBucket(cwd);
			// get_state 即探活:进程不存在时主进程懒启动
			await refreshActiveState();
			// 恢复该工作区记住的模型/思考等级
			await applyModelPref(cwd);
			// 桶为空且进程里已有会话内容 → 水合(应用重启后恢复画面)
			if (activeWs().messages.length === 0) {
				// 水合期间到达的事件先缓冲,完成后回放:否则整体替换会把刚到的流式增量冲掉
				hydrating.add(cwd);
				try {
					const resp = await window.piApi.sendCommand(cwd, { type: "get_entries" });
					const entries =
						((resp.data as { entries?: SessionEntry[] } | undefined)?.entries ?? []) as SessionEntry[];
					if (entries.length > 0) {
						patchWs(cwd, { messages: hydrateMessages(entries) });
					}
				} catch {
					/* 新进程无历史属正常 */
				} finally {
					flushHydration(cwd);
				}
			}
			await loadGlobals(cwd);
		},

		sendPrompt: async (text, images) => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				// 流式中再发消息走 steer(斜杠命令仍可立即执行)
				const streaming = activeWs().isStreaming && !text.startsWith("/");
				const cmd: Record<string, unknown> = streaming
					? { type: "steer", message: text }
					: { type: "prompt", message: text };
				if (images && images.length > 0) cmd.images = images;
				await window.piApi.sendCommand(cwd, cmd);
			} catch (err) {
				get().pushToast(`发送失败:${(err as Error).message}`, "error");
			}
		},

		abort: async () => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				await window.piApi.sendCommand(cwd, { type: "abort" });
			} catch (err) {
				get().pushToast(`中止失败:${(err as Error).message}`, "error");
			}
		},

		/** 重发上一条用户消息(pi RPC 没有"重试/回退"语义,这里就是再发一遍) */
		retryLast: async () => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			const msgs = get().byCwd[cwd]?.messages ?? [];
			const last = [...msgs].reverse().find((m) => m.role === "user" && m.text);
			if (!last?.text) {
				get().pushToast("没有可重发的消息", "warning");
				return;
			}
			await get().sendPrompt(last.text);
		},

		compact: async () => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				// pi 的 session.compact() 内部会先 abort agent 再压缩,流式中调用也安全;
				// 压缩结果(成功/失败/无需压缩)由 compaction_end 事件归并 toast,不在 catch 重复发
				await window.piApi.sendCommand(cwd, { type: "compact" });
			} catch (err) {
				const msg = (err as Error).message || "";
				// "Nothing to compact" 伴随 compaction_end 事件,已在那里发 info toast,这里忽略避免重复
				if (!/nothing to compact/i.test(msg)) {
					get().pushToast(`压缩失败:${msg}`, "error");
				}
			}
		},

		newSession: async () => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				const resp = await window.piApi.sendCommand(cwd, { type: "new_session" });
				const data = resp.data as { cancelled?: boolean } | undefined;
				if (data?.cancelled) {
					get().pushToast("新建会话被扩展取消", "warning");
					return;
				}
				patchWs(cwd, { messages: [], pendingCount: 0 });
				await refreshActiveState();
				void get().refreshSessions();
			} catch (err) {
				get().pushToast(`新建会话失败:${(err as Error).message}`, "error");
			}
		},

		switchToSession: async (filePath) => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				const resp = await window.piApi.sendCommand(cwd, { type: "switch_session", sessionPath: filePath });
				const data = resp.data as { cancelled?: boolean } | undefined;
				if (data?.cancelled) {
					get().pushToast("切换会话被扩展取消", "warning");
					return;
				}
				const entriesResp = await window.piApi.sendCommand(cwd, { type: "get_entries" });
				const entries =
					((entriesResp.data as { entries?: SessionEntry[] } | undefined)?.entries ?? []) as SessionEntry[];
				patchWs(cwd, { messages: hydrateMessages(entries), pendingCount: 0 });
				await refreshActiveState();
				// 非流式状态下遗留的 running 工具调用是历史中断,标记结束
				if (!activeWs().sessionState?.isStreaming) {
					patchWs(cwd, {
						messages: activeWs().messages.map((m) => ({
							...m,
							toolCalls: m.toolCalls.map((c) =>
								c.status === "running" ? { ...c, status: "done" as const } : c,
							),
						})),
					});
				}
				patchWs(cwd, { activeSessionFile: filePath });
			} catch (err) {
				get().pushToast(`切换会话失败:${(err as Error).message}`, "error");
			}
		},

		refreshSessions: async () => {
			try {
				const sessions = await window.piApi.listSessions();
				set({ sessions });
			} catch {
				/* 忽略 */
			}
		},

		refreshActive: () => refreshActiveState(),

		reloadThinkingLevels: async () => {
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				const resp = await window.piApi.sendCommand(cwd, { type: "get_available_thinking_levels" });
				const levels = (resp.data as { levels?: ThinkingLevel[] } | undefined)?.levels;
				set({ thinkingLevels: levels && levels.length > 0 ? levels : ["off"] });
			} catch {
				/* 忽略 */
			}
		},

		refreshWorkspaces: async () => {
			try {
				const workspaces = await window.piApi.listWorkspaces();
				set({ workspaces });
			} catch {
				/* 忽略 */
			}
		},

		addWorkspace: async () => {
			try {
				const cwd = await window.piApi.addWorkspace();
				if (!cwd) return;
				await get().refreshWorkspaces();
				await get().setActive(cwd);
			} catch (err) {
				get().pushToast(`添加工作区失败:${(err as Error).message}`, "error");
			}
		},

		removeWorkspace: async (cwd) => {
			try {
				await window.piApi.removeWorkspace(cwd);
				forget(cwd);
				await get().refreshWorkspaces();
				if (get().activeCwd === cwd) {
					const next = get().workspaces.find((w) => !w.archived)?.cwd;
					if (next) await get().setActive(next);
					else set({ activeCwd: "" });
				}
			} catch (err) {
				get().pushToast(`删除工作区失败:${(err as Error).message}`, "error");
			}
		},

		archiveWorkspace: async (cwd) => {
			try {
				await window.piApi.archiveWorkspace(cwd);
				forget(cwd);
				await get().refreshWorkspaces();
				if (get().activeCwd === cwd) {
					const next = get().workspaces.find((w) => !w.archived)?.cwd;
					if (next) await get().setActive(next);
					else set({ activeCwd: "" });
				}
				get().pushToast("已归档,可从底部「已归档」恢复", "info");
			} catch (err) {
				get().pushToast(`归档失败:${(err as Error).message}`, "error");
			}
		},

		restoreWorkspace: async (cwd) => {
			try {
				await window.piApi.restoreWorkspace(cwd);
				await get().refreshWorkspaces();
				await get().setActive(cwd);
			} catch (err) {
				get().pushToast(`恢复失败:${(err as Error).message}`, "error");
			}
		},

		toggleExpanded: (cwd) => {
			set((s) => {
				const current = s.expandedCwds[cwd] ?? cwd === s.activeCwd;
				return { expandedCwds: { ...s.expandedCwds, [cwd]: !current } };
			});
		},

		newSessionIn: async (cwd) => {
			await get().setActive(cwd);
			set((s) => ({ expandedCwds: { ...s.expandedCwds, [cwd]: true } }));
			await get().newSession();
		},

		openSession: async (cwd, filePath) => {
			// 先激活目标 workspace(命令路由到对应进程),再切会话——保证上下文隔离
			await get().setActive(cwd);
			set((s) => ({ expandedCwds: { ...s.expandedCwds, [cwd]: true } }));
			await get().switchToSession(filePath);
		},

		deleteSession: async (filePath) => {
			const ok = await window.piApi.sessionDelete(filePath);
			if (!ok) {
				get().pushToast("删除会话失败", "error");
				return;
			}
			const cwd = get().activeCwd;
			const wasActive = get().byCwd[cwd]?.activeSessionFile === filePath;
			await get().refreshSessions();
			if (wasActive) {
				const remaining = get().sessions.filter((s) => s.cwd === cwd);
				if (remaining.length > 0) await get().switchToSession(remaining[0].filePath);
			}
			get().pushToast("会话已删除", "info");
		},
		archiveSession: async (filePath) => {
			const ok = await window.piApi.sessionArchive(filePath);
			if (!ok) {
				get().pushToast("归档会话失败", "error");
				return;
			}
			const cwd = get().activeCwd;
			const wasActive = get().byCwd[cwd]?.activeSessionFile === filePath;
			await get().refreshSessions();
			if (wasActive) {
				const remaining = get().sessions.filter((s) => s.cwd === cwd);
				if (remaining.length > 0) await get().switchToSession(remaining[0].filePath);
			}
			get().pushToast("会话已归档", "info");
		},

		respondUi: (id, payload) => {
			const cwd = get().activeCwd;
			const ws = activeWs();
			patchWs(cwd, { uiQueue: ws.uiQueue.filter((r) => r.id !== id) });
			// extension_ui_response 是即发即弃,sendCommand 内部不会等待响应
			void window.piApi
				.sendCommand(cwd, { type: "extension_ui_response", id, ...payload })
				.catch((err) => get().pushToast(`UI 响应发送失败:${err.message}`, "error"));
		},

		pushToast: (message, kind = "info", actionCwd) => {
			const id = ++toastSeq;
			set((s) => ({ toasts: [...s.toasts, { id, message, kind, actionCwd }] }));
			// 停留时长按重要性区分:错误要留够读的时间,带"前往"的也不能一闪而过
			const ttlMs = kind === "error" ? 8000 : kind === "warning" ? 5000 : actionCwd ? 5000 : 3000;
			setTimeout(() => get().dismissToast(id), ttlMs);
		},

		dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

		modelManagerOpen: false,
		setModelManagerOpen: (open) => set({ modelManagerOpen: open }),

		envSettingsOpen: false,
		setEnvSettingsOpen: (open) => set({ envSettingsOpen: open }),

		setOcrEngine: (e) => {
			localStorage.setItem("ocrEngine", e);
			set({ ocrEngine: e });
		},

		setApprovalMode: (cwd, mode) => {
			// 先乐观更新 UI,再交给主进程落盘(主进程是权威,失败会提示)
			set((s) => ({ approvalModeByCwd: { ...s.approvalModeByCwd, [cwd]: mode } }));
			void window.piApi.setApprovalMode(cwd, mode).catch((err) => {
				get().pushToast(`审批模式保存失败:${(err as Error).message}`, "error");
			});
		},

		reloadModels: async () => {
			// 主进程已重启全部后端;这里重拉模型清单(下次 send 时进程懒启动,读的是新配置)
			const cwd = get().activeCwd;
			if (!cwd) return;
			try {
				const resp = await window.piApi.sendCommand(cwd, { type: "get_available_models" });
				set({ models: (resp.data as { models?: Model[] } | undefined)?.models ?? [] });
			} catch (err) {
				get().pushToast(`刷新模型列表失败:${(err as Error).message}`, "error");
			}
			// 进程重启后回到默认模型,恢复该工作区记住的选择
			await applyModelPref(cwd);
			await refreshActiveState();
			await get().reloadThinkingLevels();
		},
	};
});

/* ---------------- 组件用选择器 ---------------- */

/** 订阅当前 workspace 桶的某个字段 */
export function useActiveWs<T>(sel: (ws: WorkspaceViewState) => T): T {
	return useSessionStore((s) => sel(s.byCwd[s.activeCwd] ?? EMPTY_WS));
}

/** 当前 workspace 的后端进程状态 */
export function useActiveBackend(): BackendStatus {
	return useSessionStore((s) => s.backendByCwd[s.activeCwd] ?? DEFAULT_BACKEND);
}
