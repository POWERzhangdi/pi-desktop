/**
 * 模型提供商管理:
 * - 内置 provider 的 API key 读写 ~/.pi/agent/auth.json(完整 key 不出主进程)
 * - 自定义 provider 读写 ~/.pi/agent/models.json
 * pi 进程启动时缓存这两份配置(实测不热感知),所以任何变更后由调用方重启全部后端进程。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	CustomProvider,
	CustomProviderModel,
	ProviderStatus,
	ProviderTestRequest,
	ProviderTestResult,
} from "../shared/ipc";
import type { PiConfig } from "../shared/ipc";
import { writeJsonAtomic } from "./util/json-file";

/**
 * 精选内置 provider 目录(id 即 auth.json/env 的 provider key)。
 * api/baseUrl 与 pi 包内 provider 定义一致(测试连接按相同规则发请求)。
 */
const BUILTIN_PROVIDERS: Array<{
	id: string;
	name: string;
	note: string;
	env: string;
	api: string;
	baseUrl: string;
}> = [
	{ id: "kimi-coding", name: "Kimi For Coding", note: "platform.moonshot.cn", env: "KIMI_API_KEY", api: "anthropic-messages", baseUrl: "https://api.kimi.com/coding" },
	{ id: "deepseek", name: "DeepSeek 深度求索", note: "platform.deepseek.com", env: "DEEPSEEK_API_KEY", api: "openai-completions", baseUrl: "https://api.deepseek.com" },
	{ id: "zai-coding-cn", name: "智谱 GLM(国内)", note: "bigmodel.cn", env: "ZAI_CODING_CN_API_KEY", api: "openai-completions", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" },
	{ id: "zai", name: "智谱 GLM(国际)", note: "z.ai", env: "ZAI_API_KEY", api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
	{ id: "minimax-cn", name: "MiniMax(国内)", note: "platform.minimaxi.com", env: "MINIMAX_CN_API_KEY", api: "anthropic-messages", baseUrl: "https://api.minimaxi.com/anthropic" },
	{ id: "minimax", name: "MiniMax(国际)", note: "platform.minimax.io", env: "MINIMAX_API_KEY", api: "anthropic-messages", baseUrl: "https://api.minimax.io/anthropic" },
	{ id: "qwen-token-plan-cn", name: "通义千问(国内)", note: "bailian.console.aliyun.com", env: "QWEN_TOKEN_PLAN_CN_API_KEY", api: "openai-completions", baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" },
	{ id: "openai", name: "OpenAI", note: "platform.openai.com", env: "OPENAI_API_KEY", api: "openai-responses", baseUrl: "https://api.openai.com/v1" },
	{ id: "anthropic", name: "Anthropic Claude", note: "console.anthropic.com", env: "ANTHROPIC_API_KEY", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
	{ id: "google", name: "Google Gemini", note: "aistudio.google.com", env: "GEMINI_API_KEY", api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
	{ id: "openrouter", name: "OpenRouter 聚合", note: "openrouter.ai", env: "OPENROUTER_API_KEY", api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1" },
	{ id: "xai", name: "xAI Grok", note: "console.x.ai", env: "XAI_API_KEY", api: "openai-completions", baseUrl: "https://api.x.ai/v1" },
	{ id: "groq", name: "Groq", note: "console.groq.com", env: "GROQ_API_KEY", api: "openai-completions", baseUrl: "https://api.groq.com/openai/v1" },
	{ id: "mistral", name: "Mistral", note: "console.mistral.ai", env: "MISTRAL_API_KEY", api: "openai-completions", baseUrl: "https://api.mistral.ai" },
];

type AuthFile = Record<string, { type?: string; key?: string } | undefined>;

interface ModelsFile {
	providers?: Record<string, Record<string, unknown> | undefined>;
	[extra: string]: unknown;
}

export class ProvidersStore {
	/** 传 getter 而不是快照:config 变更后路径仍然正确 */
	constructor(private readonly getConfig: () => PiConfig) {}

	/** sessionsDir 即 ~/.pi/agent/sessions,取其父目录 */
	private get agentDir(): string {
		return dirname(this.getConfig().sessionsDir);
	}

	private get authPath(): string {
		return join(this.agentDir, "auth.json");
	}

	private get modelsPath(): string {
		return join(this.agentDir, "models.json");
	}

	private readAuth(): AuthFile {
		try {
			return JSON.parse(readFileSync(this.authPath, "utf8")) as AuthFile;
		} catch {
			return {};
		}
	}

	private writeAuth(auth: AuthFile): void {
		// 含密钥:0600 + 原子写(Windows 上 mode 可能被忽略,不影响)
		writeJsonAtomic(this.authPath, auth, { mode: 0o600 });
	}

	private readModelsFile(): ModelsFile {
		try {
			return JSON.parse(readFileSync(this.modelsPath, "utf8")) as ModelsFile;
		} catch {
			return {};
		}
	}

	private writeModelsFile(file: ModelsFile): void {
		writeJsonAtomic(this.modelsPath, file);
	}

	private static mask(key: string): string {
		if (key.length <= 6) return "••••";
		return `${key.slice(0, 3)}…${key.slice(-4)}`;
	}

	/** 内置 provider 状态(auth.json 优先,其次环境变量探测) */
	listBuiltins(): ProviderStatus[] {
		const auth = this.readAuth();
		return BUILTIN_PROVIDERS.map((p) => {
			const entry = auth[p.id];
			if (entry?.key) {
				return {
					id: p.id,
					name: p.name,
					note: p.note,
					api: p.api,
					baseUrl: p.baseUrl,
					envVar: p.env,
					configured: true,
					maskedKey: ProvidersStore.mask(entry.key),
					source: "auth" as const,
				};
			}
			if (process.env[p.env]) {
				return {
					id: p.id,
					name: p.name,
					note: p.note,
					api: p.api,
					baseUrl: p.baseUrl,
					envVar: p.env,
					configured: true,
					source: "env" as const,
				};
			}
			return {
				id: p.id,
				name: p.name,
				note: p.note,
				api: p.api,
				baseUrl: p.baseUrl,
				envVar: p.env,
				configured: false,
				source: null,
			};
		});
	}

	setKey(providerId: string, key: string): void {
		if (!BUILTIN_PROVIDERS.some((p) => p.id === providerId)) {
			throw new Error(`未知的内置 provider: ${providerId}`);
		}
		const auth = this.readAuth();
		auth[providerId] = { type: "api_key", key };
		this.writeAuth(auth);
	}

	removeKey(providerId: string): void {
		const auth = this.readAuth();
		if (providerId in auth) {
			delete auth[providerId];
			this.writeAuth(auth);
		}
	}

	/** 列出自定义 provider(models.json),key 原样返回供编辑表单回填 */
	listCustoms(): CustomProvider[] {
		const file = this.readModelsFile();
		const out: CustomProvider[] = [];
		for (const [id, raw] of Object.entries(file.providers ?? {})) {
			if (!raw || typeof raw !== "object") continue;
			const models = Array.isArray(raw.models) ? (raw.models as CustomProviderModel[]) : [];
			out.push({
				id,
				baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
				api: typeof raw.api === "string" ? raw.api : "openai-completions",
				apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
				models,
			});
		}
		return out;
	}

	/** 新增/编辑自定义 provider;编辑时保留表单之外的既有字段(headers/compat 等) */
	upsertCustom(provider: CustomProvider, originalId?: string): void {
		const id = provider.id.trim();
		if (!id) throw new Error("provider id 不能为空");
		if (!provider.baseUrl.trim()) throw new Error("baseUrl 不能为空");
		if (provider.models.length === 0) throw new Error("至少需要一个模型");

		const file = this.readModelsFile();
		const providers = { ...file.providers };
		const targetId = originalId ?? id;
		const existing = providers[targetId] ?? {};
		if (originalId && originalId !== id) delete providers[originalId];

		providers[id] = {
			...existing,
			baseUrl: provider.baseUrl.trim(),
			api: provider.api,
			...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
			models: provider.models.map((m) => {
				const entry: Record<string, unknown> = { ...m, id: m.id.trim() };
				if (!m.name?.trim()) delete entry.name;
				return entry;
			}),
		};
		// apiKey 清空表示删除(而不是保留旧值):表单传空串时移除该字段
		if (provider.apiKey !== undefined && !provider.apiKey.trim()) {
			delete providers[id]!.apiKey;
		}
		file.providers = providers;
		this.writeModelsFile(file);
	}

	removeCustom(providerId: string): void {
		const file = this.readModelsFile();
		if (file.providers && providerId in file.providers) {
			const providers = { ...file.providers };
			delete providers[providerId];
			file.providers = providers;
			this.writeModelsFile(file);
		}
	}

	/** 读取内置 provider 的完整密钥(来自 auth.json);未配置或非内置返回 undefined */
	getKey(providerId: string): string | undefined {
		if (!BUILTIN_PROVIDERS.some((p) => p.id === providerId)) return undefined;
		const auth = this.readAuth();
		return auth[providerId]?.key;
	}
}

/* ---------------- 测试连接 ---------------- */

const TEST_TIMEOUT_MS = 15_000;

/** 解析测试 key:本次输入(可 $ENV)> auth.json 已存 key > 环境变量回退 */
function resolveTestKey(
	req: ProviderTestRequest,
	readStoredKey?: (providerId: string) => string | undefined,
): string | undefined {
	const raw = req.apiKey?.trim();
	if (raw) {
		if (raw.startsWith("$")) return process.env[raw.slice(1)];
		return raw;
	}
	if (req.providerId && readStoredKey) {
		// 明文 key 只留在主进程:渲染进程不传 key 时由这里补
		const stored = readStoredKey(req.providerId);
		if (stored) return stored;
	}
	if (req.envVar) return process.env[req.envVar];
	return undefined;
}

/**
 * 直接对 provider 端点发最小请求验证配置(不经过 pi 的缓存配置):
 * - models 模式:GET /models(内置 provider,验 key + 端点可达)
 * - chat 模式:最小对话请求(自定义 provider,验 baseUrl + key + 模型全链路)
 * URL 拼接与 pi 实际请求一致(baseUrl 原样 + SDK 后缀)。
 */
export async function testProviderConnection(
	req: ProviderTestRequest,
	readStoredKey?: (providerId: string) => string | undefined,
): Promise<ProviderTestResult> {
	const base = req.baseUrl.trim().replace(/\/+$/, "");
	if (!base) return { ok: false, error: "baseUrl 为空" };
	const key = resolveTestKey(req, readStoredKey);
	const started = Date.now();

	try {
		const headers: Record<string, string> = { "content-type": "application/json" };
		if (key) {
			if (req.api === "anthropic-messages") {
				headers["x-api-key"] = key;
				headers["anthropic-version"] = "2023-06-01";
			} else if (req.api === "google-generative-ai") {
				headers["x-goog-api-key"] = key;
			} else {
				headers["authorization"] = `Bearer ${key}`;
			}
		}

		let url: string;
		let init: RequestInit;
		if (req.mode === "models") {
			url = req.api === "anthropic-messages" ? `${base}/v1/models` : `${base}/models`;
			init = { method: "GET", headers, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) };
		} else {
			const model = req.model?.trim();
			if (!model) return { ok: false, error: "缺少测试模型(请先填写模型列表)" };
			if (req.api === "anthropic-messages") {
				url = `${base}/v1/messages`;
				init = {
					method: "POST",
					headers,
					body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
				};
			} else if (req.api === "google-generative-ai") {
				url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
				init = {
					method: "POST",
					headers,
					body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
				};
			} else if (req.api === "openai-responses") {
				url = `${base}/responses`;
				init = {
					method: "POST",
					headers,
					body: JSON.stringify({ model, input: "ping", max_output_tokens: 1, stream: false }),
				};
			} else {
				url = `${base}/chat/completions`;
				init = {
					method: "POST",
					headers,
					body: JSON.stringify({
						model,
						messages: [{ role: "user", content: "ping" }],
						max_tokens: 1,
						stream: false,
					}),
				};
			}
		}

		const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
		const text = await res.text().catch(() => "");
		const latencyMs = Date.now() - started;
		if (!res.ok) {
			const snippet = text.trim().replace(/\s+/g, " ").slice(0, 300);
			return {
				ok: false,
				status: res.status,
				latencyMs,
				error: snippet ? `HTTP ${res.status}: ${snippet}` : `HTTP ${res.status}(无响应体)`,
			};
		}
		return { ok: true, status: res.status, latencyMs };
	} catch (err) {
		return { ok: false, latencyMs: Date.now() - started, error: `连接失败: ${(err as Error).message}` };
	}
}
