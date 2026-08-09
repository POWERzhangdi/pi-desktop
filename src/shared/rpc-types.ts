/**
 * pi RPC 协议类型(从 @earendil-works/pi-coding-agent 的 rpc-types.d.ts 精简抄录)。
 * 仅保留 MVP 所需部分;运行期解析保持宽松,未知字段不校验、不报错。
 */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface Model {
	id: string;
	name: string;
	api?: string;
	provider: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: ModelCost;
}

/* ---------------- 消息内容块 ---------------- */

export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	redacted?: boolean;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export type AssistantContentBlock = TextContent | ThinkingContent | ToolCallContent;

/* ---------------- 消息 ---------------- */

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp?: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: AssistantContentBlock[];
	provider?: string;
	model?: string;
	usage?: Usage;
	stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
	errorMessage?: string;
	timestamp?: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	isError?: boolean;
	timestamp?: number;
}

export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode?: number;
	cancelled?: boolean;
	truncated?: boolean;
	timestamp?: number;
}

export interface CustomMessage {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display?: boolean;
	timestamp?: number;
}

export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	timestamp?: number;
}

export interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	timestamp?: number;
}

export type AgentMessage =
	| UserMessage
	| AssistantMessage
	| ToolResultMessage
	| BashExecutionMessage
	| CustomMessage
	| CompactionSummaryMessage
	| BranchSummaryMessage;

/* ---------------- 命令(stdin) ---------------- */

interface CmdBase {
	id?: string | number;
}

export type RpcCommand =
	| (CmdBase & { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] })
	| (CmdBase & { type: "steer"; message: string; images?: ImageContent[] })
	| (CmdBase & { type: "follow_up"; message: string; images?: ImageContent[] })
	| (CmdBase & { type: "abort" })
	| (CmdBase & { type: "new_session" })
	| (CmdBase & { type: "switch_session"; sessionPath: string })
	| (CmdBase & { type: "get_state" })
	| (CmdBase & { type: "get_entries"; since?: string })
	| (CmdBase & { type: "set_model"; provider: string; modelId: string })
	| (CmdBase & { type: "get_available_models" })
	| (CmdBase & { type: "set_thinking_level"; level: ThinkingLevel })
	| (CmdBase & { type: "get_available_thinking_levels" })
	| (CmdBase & { type: "get_session_stats" })
	| (CmdBase & { type: "get_commands" })
	| (CmdBase & { type: "compact"; customInstructions?: string });

/* ---------------- 响应(stdout) ---------------- */

export interface RpcResponse {
	id?: string | number;
	type: "response";
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

/* ---------------- 事件(stdout,无 id) ---------------- */

export type AssistantMessageEvent =
	| { type: "start" }
	| { type: "text_start"; contentIndex: number }
	| { type: "text_delta"; contentIndex: number; delta: string }
	| { type: "text_end"; contentIndex: number; content?: string }
	| { type: "thinking_start"; contentIndex: number }
	| { type: "thinking_delta"; contentIndex: number; delta: string }
	| { type: "thinking_end"; contentIndex: number }
	| { type: "toolcall_start"; contentIndex: number }
	| { type: "toolcall_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallContent }
	| { type: "done"; reason?: string }
	| { type: "error"; reason?: string; errorMessage?: string };

export interface ToolResultPayload {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
}

export type RpcEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages?: AgentMessage[]; willRetry?: boolean }
	| { type: "agent_settled" }
	| { type: "turn_start" }
	| { type: "turn_end"; message?: AgentMessage; toolResults?: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
			partialResult?: ToolResultPayload;
	  }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result?: ToolResultPayload;
			isError?: boolean;
	  }
	| { type: "queue_update"; steering?: string[]; followUp?: string[] }
	| { type: "compaction_start"; reason?: string }
	| { type: "compaction_end"; reason?: string; aborted?: boolean; willRetry?: boolean; errorMessage?: string }
	| { type: "auto_retry_start"; attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string }
	| { type: "auto_retry_end"; success?: boolean; attempt?: number; finalError?: string }
	| { type: "extension_error"; extensionPath?: string; event?: string; error?: string }
	| { type: string; [key: string]: unknown }; // 其余事件宽容兜底

/* ---------------- Extension UI 子协议 ---------------- */

export type ExtensionUiRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
	| { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines?: string[]; widgetPlacement?: string }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export type ExtensionUiResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

/* ---------------- 会话文件 ---------------- */

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
}

export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

/** 宽松表示:get_entries 返回的任意 entry */
export type SessionEntry = SessionEntryBase & { message?: AgentMessage; [key: string]: unknown };

/* ---------------- 状态 / 统计 / 命令清单 ---------------- */

export interface RpcSessionState {
	model?: Model | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

export interface SessionStats {
	sessionFile?: string;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface CommandInfo {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	location?: string;
	path?: string;
}
