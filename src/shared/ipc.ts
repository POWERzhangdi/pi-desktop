/**
 * 主进程 ↔ 渲染进程 IPC 契约(多 workspace 版)。
 * 所有命令带 cwd,主进程按 cwd 路由到对应的 pi 进程(懒启动);
 * 事件/状态以 {cwd, ...} 信封回传,渲染进程按 cwd 分桶归并。
 */

export const IpcChannels = {
	rpcCommand: "rpc:command",
	rpcEvent: "rpc:event",
	backendStatus: "backend:status",
	sessionsList: "sessions:list",
	configGet: "config:get",
	workspacesList: "workspaces:list",
	workspacesAdd: "workspaces:add",
	workspacesRemove: "workspaces:remove",
	workspacesArchive: "workspaces:archive",
	workspacesRestore: "workspaces:restore",
	providersList: "providers:list",
	providersSetKey: "providers:setKey",
	providersRemoveKey: "providers:removeKey",
	providersUpsertCustom: "providers:upsertCustom",
	providersRemoveCustom: "providers:removeCustom",
	providersTest: "providers:test",
	mcpList: "mcp:list",
	mcpUpsert: "mcp:upsert",
	mcpRemove: "mcp:remove",
	mcpTest: "mcp:test",
	ocrRecognize: "ocr:recognize",
	envCheck: "env:check",
	ocrInstallRapidocr: "ocr:installRapidocr",
	ocrInstallProgress: "ocr:installProgress",
	pdfExtract: "pdf:extract",
	excelExtract: "excel:extract",
	setNativeTheme: "nativeTheme:set",
	filesList: "files:list",
	filesWarm: "files:warm",
	configSet: "config:set",
	sessionDelete: "session:delete",
	sessionArchive: "session:archive",
	/** 用系统浏览器打开外部链接(渲染进程不直接持有 shell) */
	openExternal: "shell:openExternal",
	/** 命令审批策略(主进程持有,渲染进程只读/改,不能绕过) */
	approvalGet: "approval:get",
	approvalSet: "approval:set",
	approvalAutoTurn: "approval:autoTurn",
	/** 应用菜单/快捷键触发的动作(主进程 → 渲染进程) */
	appCommand: "app:command",
} as const;

/** 菜单与快捷键能触发的渲染端动作 */
export type AppCommand =
	| "session:new"
	| "workspace:add"
	| "settings:open"
	| "models:open"
	| "zoom:in"
	| "zoom:out"
	| "zoom:reset"
	| "theme:toggle";

/** 命令审批模式:full=完全访问(危险命令自动放行);approve=审批(弹框) */
export type ApprovalMode = "full" | "approve";

/** 命令审批 confirm 请求的标题(扩展侧硬编码,主进程据此识别审批请求) */
export const APPROVAL_CONFIRM_TITLE = "命令审批";

export interface SessionSummary {
	filePath: string;
	sessionId: string;
	cwd: string;
	timestamp: string;
	title: string;
	mtimeMs: number;
}

export interface PiConfig {
	nodePath: string;
	cliPath: string;
	sessionsDir: string;
	cwd: string;
	/** 自定义 Python 路径(OCR RapidOCR 用);未配置则用系统 python */
	pythonPath?: string;
	/** 运行时解析详情(设置面板展示来源用);resolveConfig 时附带填充 */
	runtimeInfo?: RuntimeInfo;
}

/** 运行时解析来源:env=环境变量,config=配置文件,detected=自动检测,bundled=内置兜底,missing=缺失 */
export type RuntimeSource = "env" | "config" | "detected" | "bundled" | "missing";

/** 运行时解析详情(pi / Node 各自从哪来) */
export interface RuntimeInfo {
	node: { path: string; source: RuntimeSource };
	cli: { path: string; source: RuntimeSource };
}

/** 运行环境检测结果(设置面板展示:pi / Node / Python 路径与版本 + rapidocr 是否就绪) */
export interface EnvInfo {
	pi: { ok: boolean; path: string; version: string | null };
	node: { path: string; version: string };
	python: { ok: boolean; path: string | null; version: string | null };
	rapidocr: boolean;
}

/** 工作区文件项(@ 引用补全用) */
export interface FileEntry {
	/** 文件名 */
	name: string;
	/** 绝对路径(选中后插入输入框,pi 收到会 read) */
	path: string;
	/** 相对 cwd 的目录(根目录文件为空) */
	dir: string;
	/** 是否目录(工作区根下的项目目录) */
	isDir?: boolean;
}

export interface BackendStatus {
	state: "starting" | "ready" | "crashed";
	detail?: string;
}

/** RPC 事件信封 */
export interface RpcEventEnvelope {
	cwd: string;
	evt: Record<string, unknown>;
}

/** 后端状态信封 */
export interface BackendStatusEnvelope {
	cwd: string;
	status: BackendStatus;
}

/** workspace 列表项 */
export interface WorkspaceInfo {
	cwd: string;
	/** 目录名(cwd 最后一段) */
	name: string;
	/** manual=手动添加;discovered=从会话目录发现 */
	source: "manual" | "discovered";
	/** true=已归档(收进"已归档"区,可恢复) */
	archived: boolean;
	sessionCount: number;
	/** 最近会话修改时间;无会话为 0 */
	lastActiveMs: number;
}

/** 内置 provider 的密钥配置状态(完整 key 不出主进程,只给掩码) */
export interface ProviderStatus {
	/** auth.json 的 provider key,如 "deepseek" */
	id: string;
	/** 中文显示名 */
	name: string;
	/** 一句话提示(去哪拿 key) */
	note: string;
	/** pi 实际使用的 API 类型(openai-completions / openai-responses / anthropic-messages / google-generative-ai) */
	api: string;
	/** pi 内置定义的真实 baseUrl(测试连接用) */
	baseUrl: string;
	/** 该提供商的环境变量名(测试连接时未填 key 可回退) */
	envVar: string;
	configured: boolean;
	/** 掩码后的 key,如 "sk-…3f2a";仅 source=auth 时有 */
	maskedKey?: string;
	/** auth=写在 auth.json;env=来自环境变量;null=未配置 */
	source: "auth" | "env" | null;
}

/** 测试连接请求(主进程直接发最小请求验证,不走 pi 缓存配置) */
export interface ProviderTestRequest {
	/** models=列模型接口(内置 provider,验 key+端点);chat=最小对话(自定义 provider,验全链路含模型) */
	mode: "models" | "chat";
	api: string;
	baseUrl: string;
	/** 用户本次输入的 key(可含 $ENV 引用);不传则回退到 auth.json / 环境变量 */
	apiKey?: string;
	/** 内置 provider 未填 key 时回退的环境变量名 */
	envVar?: string;
	/** 内置 provider id:未填 key 时由主进程从 auth.json 读取(明文不出主进程) */
	providerId?: string;
	/** chat 模式必填 */
	model?: string;
}

/** 测试连接结果 */
export interface ProviderTestResult {
	ok: boolean;
	error?: string;
	status?: number;
	latencyMs?: number;
}

/** models.json 里单个自定义模型 */
export interface CustomProviderModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

/** models.json 里的自定义 provider(编辑表单需要完整内容,故 key 原样返回) */
export interface CustomProvider {
	id: string;
	baseUrl: string;
	api: string;
	apiKey?: string;
	models: CustomProviderModel[];
}

/** MCP 服务器配置(mcp.json 的 servers 数组项) */
export interface McpServerConfig {
	/** 唯一 id(小写字母/数字/下划线),也是工具名前缀 mcp_<id>_ 的来源 */
	id: string;
	/** 展示名 */
	name: string;
	/** stdio=本地子进程;http=远程 URL(Streamable HTTP/SSE) */
	transport: "stdio" | "http";
	/** stdio 启动命令,如 npx / node */
	command?: string;
	/** stdio 启动参数 */
	args?: string[];
	/** 注入子进程的环境变量(可放密钥) */
	env?: Record<string, string>;
	/** stdio 子进程工作目录 */
	cwd?: string;
	/** http 传输的 URL */
	url?: string;
	/** 是否启用(未启用不连接、不注册工具) */
	enabled: boolean;
}

/** 测试连接结果 */
export interface McpTestResult {
	ok: boolean;
	error?: string;
	toolCount?: number;
	tools?: string[];
}

export interface PiApi {
	/** 运行平台(win32 / darwin / linux),渲染端按平台展示提示文案 */
	platform: string;
	/** 向指定 workspace 的 pi 进程发送命令;进程不存在则懒启动;失败 reject */
	sendCommand(cwd: string, cmd: Record<string, unknown>): Promise<Record<string, unknown>>;
	/** 订阅 RPC 事件流(带 cwd 信封),返回取消订阅函数 */
	onRpcEvent(cb: (env: RpcEventEnvelope) => void): () => void;
	/** 订阅后端进程状态(带 cwd 信封),返回取消订阅函数 */
	onBackendStatus(cb: (env: BackendStatusEnvelope) => void): () => void;
	/** 会话列表;传 cwd 则只返回该 workspace 的会话 */
	listSessions(cwd?: string): Promise<SessionSummary[]>;
	/** 后端配置(cliPath/sessionsDir 等) */
	getConfig(): Promise<PiConfig>;
	/** workspace 列表(手动添加 ∪ 会话发现 − 隐藏,按最近活跃倒序) */
	listWorkspaces(): Promise<WorkspaceInfo[]>;
	/** 弹出系统目录选择框并注册为新 workspace;取消返回 null */
	addWorkspace(): Promise<string | null>;
	/** 删除 workspace:手动项删除,发现项隐藏(只能重新手动添加找回);进程在跑则先杀掉 */
	removeWorkspace(cwd: string): Promise<void>;
	/** 归档 workspace:收进"已归档"区(可恢复);进程在跑则杀掉 */
	archiveWorkspace(cwd: string): Promise<void>;
	/** 从归档区恢复 workspace */
	restoreWorkspace(cwd: string): Promise<void>;
	/** 内置 provider 密钥状态 + models.json 自定义 provider 列表 */
	listProviders(): Promise<{ builtins: ProviderStatus[]; customs: CustomProvider[] }>;
	/** 写入内置 provider 的 API key 到 auth.json;保存后全部后端进程重启生效 */
	setProviderKey(providerId: string, key: string): Promise<void>;
	/** 从 auth.json 移除某 provider 的 key;保存后全部后端进程重启生效 */
	removeProviderKey(providerId: string): Promise<void>;
	/** 新增/编辑 models.json 自定义 provider(originalId 用于改名);保存后全部后端重启 */
	upsertCustomProvider(provider: CustomProvider, originalId?: string): Promise<void>;
	/** 删除 models.json 自定义 provider;保存后全部后端重启 */
	removeCustomProvider(providerId: string): Promise<void>;
	/** 测试模型连接(内置 provider 验 key+端点;自定义 provider 发最小对话验全链路)。
	 *  key 不回传渲染进程:传 providerId 由主进程从 auth.json 取 */
	testProviderConnection(req: ProviderTestRequest): Promise<ProviderTestResult>;
	/** MCP 服务器列表(读 ~/.pi/agent/mcp.json;首次调用会确保扩展已部署) */
	listMcpServers(): Promise<McpServerConfig[]>;
	/** 新增/编辑 MCP 服务器(originalId 用于改名);保存后重启全部后端生效 */
	saveMcpServer(server: McpServerConfig, originalId?: string): Promise<McpServerConfig[]>;
	/** 删除 MCP 服务器;保存后重启全部后端 */
	removeMcpServer(serverId: string): Promise<McpServerConfig[]>;
	/** 测试连接:用扩展的 SDK 连一次 server 并 list_tools,返回工具数 */
	testMcpServer(server: McpServerConfig): Promise<McpTestResult>;
	/** 用 pi 的 ocr 扩展识别图片文字(主进程弹框选图+加载 ocr 扩展,不走 LLM);engine 选 tesseract(默认)或 rapidocr(强,需 Python) */
	ocrRecognize(engine?: "tesseract" | "rapidocr"): Promise<string>;
	/** 检测运行环境:pi / Node / Python 路径与版本 + rapidocr 是否就绪 */
	envCheck(): Promise<EnvInfo>;
	/** 安装 rapidocr-onnxruntime(用户决定下载,不打包进客户端);进度通过 onOcrInstallProgress 推送 */
	ocrInstallRapidocr(): Promise<string>;
	/** 订阅 RapidOCR 安装进度(逐行输出);返回取消订阅函数 */
	onOcrInstallProgress(cb: (line: string) => void): () => void;
	/** 用 pi 的 read_pdf 扩展解析 PDF(主进程弹框选文件,不走 LLM);返回文本 */
	pdfExtract(): Promise<string>;
	/** 用 pi 的 read_excel 扩展解析 Excel/CSV(主进程弹框选文件,不走 LLM);返回表格文本 */
	excelExtract(): Promise<string>;
	/** 设置渲染端缩放因子(真浏览器缩放);1.0 = 100% */
	setZoomFactor(factor: number): void;
	/** 同步系统原生标题栏/边框主题(暗色下避免顶部发白) */
	setNativeTheme(dark: boolean): void;
	/** 扫描工作区文件(@ 引用补全);模糊匹配 query,返回 ≤50 条 */
	listFiles(cwd: string, query: string): Promise<FileEntry[]>;
	/** 预热工作区文件缓存(激活时后台调,@ 时即时命中) */
	filesWarm(cwd: string): Promise<void>;
	/** 写入配置(pi/Node/Python 路径等);改 cliPath/nodePath 会重启后端 */
	configSet(patch: Partial<PiConfig>): Promise<void>;
	/** 删除会话文件 */
	sessionDelete(filePath: string): Promise<boolean>;
	/** 归档会话(重命名加 .archived,移出列表) */
	sessionArchive(filePath: string): Promise<boolean>;
	/** 用系统默认浏览器打开 http(s) 链接(非 http(s) 协议直接忽略) */
	openExternal(url: string): Promise<void>;
	/** 读取各工作区的命令审批模式(主进程是唯一权威,默认 approve) */
	getApprovalModes(): Promise<Record<string, ApprovalMode>>;
	/** 设置某工作区的命令审批模式 */
	setApprovalMode(cwd: string, mode: ApprovalMode): Promise<void>;
	/** 本轮自动批准(下一轮 agent_start 自动复位) */
	setAutoApproveTurn(cwd: string, on: boolean): Promise<void>;
	/** 订阅应用菜单/快捷键动作,返回取消订阅函数 */
	onAppCommand(cb: (cmd: AppCommand) => void): () => void;
}

declare global {
	interface Window {
		piApi: PiApi;
	}
}
