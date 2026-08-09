/**
 * 模型与密钥管理页(全屏覆盖层,左右分栏 master-detail)。
 * - 左列:内置/自定义 平级分段切换(计数统一)+ 搜索 + 两行式状态列表
 * - 右列:内置=密钥管理(密钥 / 验证),自定义=分组表单(连接信息 / 模型列表 / 验证与保存)
 *
 * 任何保存都会重启全部 pi 后端进程(pi 启动时缓存配置,不热感知),
 * 之后通过 store.reloadModels() 重新拉取可用模型。
 * 进入/退出有 180/150ms 淡入淡出,Esc 可关闭。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSessionStore } from "../store/useSessionStore";
import type {
	CustomProvider,
	CustomProviderModel,
	ProviderStatus,
	ProviderTestResult,
} from "../../../shared/ipc";

/** 标签记忆的 localStorage key(独立命名,避免与现有 key 冲突) */
const TAB_KEY = "pi-desktop-model-mgr-tab";

type Tab = "builtin" | "custom";
type Selection =
	| { kind: "builtin"; id: string }
	| { kind: "custom"; id: string }
	| { kind: "new-custom" }
	| null;

/** 有工作区在跑任务时,保存前的确认(保存会重启后端、中断任务) */
function confirmIfBusy(): boolean {
	const busy = Object.values(useSessionStore.getState().byCwd).some((ws) => ws.isStreaming);
	if (!busy) return true;
	return window.confirm("当前有工作区正在运行任务。\n保存将重启全部后端进程并中断这些任务,确定继续吗?");
}

/* ---------------- 通用样式与小组件 ---------------- */

const inputCls =
	"w-full bg-ground border border-sep rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition placeholder:text-txt2/60";
const labelCls = "block text-xs text-txt2 mb-1";

const btnPrimary =
	"btn-press h-8 rounded-lg px-3 text-xs bg-accent text-white hover:bg-accent/90 disabled:opacity-40 inline-flex items-center gap-1.5";
const btnGhost =
	"btn-press h-8 rounded-lg px-3 text-xs border border-sep text-txt2 hover:text-txt hover:bg-side disabled:opacity-40 inline-flex items-center gap-1.5";
const btnDanger =
	"btn-press h-8 rounded-lg px-3 text-xs text-red hover:bg-red/10 disabled:opacity-40 inline-flex items-center gap-1.5";

function Spinner() {
	return (
		<svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
			<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
			<path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
		</svg>
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return <h3 className="text-xs font-semibold text-txt2">{children}</h3>;
}

/** 测试连接结果块(淡入) */
function TestResultBlock({
	result,
	okSuffix,
}: {
	result: ProviderTestResult;
	okSuffix?: string;
}) {
	return (
		<div
			className={`animate-list text-xs rounded-lg px-3 py-2 ${
				result.ok ? "bg-green/10 text-green" : "bg-red/10 text-red break-all whitespace-pre-wrap"
			}`}
		>
			{result.ok
				? `✓ 连接成功(${result.latencyMs ?? "?"}ms)${okSuffix ? ` · ${okSuffix}` : ""}`
				: `✗ ${result.error ?? "连接失败"}`}
		</div>
	);
}

/** 内置 provider 状态点颜色:auth=绿 / env=橙 / 未配置=灰 */
function builtinDotColor(source: "auth" | "env" | null): string {
	if (source === "auth") return "bg-green";
	if (source === "env") return "bg-orange";
	return "bg-txt2/40";
}

/** 列表非空时选首项,否则 null */
function selectFirst(tab: Tab, builtins: ProviderStatus[], customs: CustomProvider[]): Selection {
	if (tab === "builtin") return builtins.length ? { kind: "builtin", id: builtins[0].id } : null;
	return customs.length ? { kind: "custom", id: customs[0].id } : null;
}

/** 密钥输入框:默认掩码(****),小眼睛切换显隐 */
function KeyInput({
	value,
	onChange,
	onSubmit,
	placeholder,
	autoFocus,
}: {
	value: string;
	onChange: (v: string) => void;
	onSubmit?: () => void;
	placeholder?: string;
	autoFocus?: boolean;
}) {
	const [show, setShow] = useState(false);
	return (
		<div className="relative">
			<input
				type={show ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && onSubmit) onSubmit();
				}}
				placeholder={placeholder}
				autoFocus={autoFocus}
				className={`${inputCls} pr-9`}
			/>
			<button
				type="button"
				onClick={() => setShow((s) => !s)}
				title={show ? "隐藏" : "显示"}
				className="btn-press absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-txt2 hover:text-txt"
			>
				{show ? (
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
						<line x1="1" y1="1" x2="23" y2="23" />
					</svg>
				) : (
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
						<circle cx="12" cy="12" r="3" />
					</svg>
				)}
			</button>
		</div>
	);
}

/* ---------------- 内置 provider 密钥详情面 ---------------- */
function BuiltinDetail({
	provider,
	onChanged,
}: {
	provider: ProviderStatus;
	/** 保存/删除后刷新列表状态(保留选中,不卸载) */
	onChanged: () => Promise<void>;
}) {
	const [keyValue, setKeyValue] = useState("");
	/** 拉取到的原始密钥,用于判断是否改动(避免无变更触发重启) */
	const [originalKey, setOriginalKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [savedFlash, setSavedFlash] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
	const pushToast = useSessionStore((s) => s.pushToast);
	const reloadModels = useSessionStore((s) => s.reloadModels);
	const mountedRef = useRef(true);

	useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[],
	);

	// 已配置(auth)时拉取完整密钥回填(用户选择放宽安全边界,允许前端查看)
	useEffect(() => {
		let cancelled = false;
		setKeyValue("");
		setOriginalKey("");
		setTestResult(null);
		if (provider.source === "auth") {
			void (async () => {
				try {
					const full = await window.piApi.getProviderKey(provider.id);
					if (!cancelled && typeof full === "string") {
						setKeyValue(full);
						setOriginalKey(full);
					}
				} catch {
					/* 忽略读取失败 */
				}
			})();
		}
		return () => {
			cancelled = true;
		};
	}, [provider.id, provider.source]);

	const save = async () => {
		const trimmed = keyValue.trim();
		if (!trimmed || trimmed === originalKey) return;
		if (!confirmIfBusy()) return;
		setSaving(true);
		try {
			await window.piApi.setProviderKey(provider.id, trimmed);
			pushToast(`${provider.name} 密钥已保存,后端重启后生效`, "info");
			setOriginalKey(trimmed);
			setSavedFlash(true);
			window.setTimeout(() => {
				if (mountedRef.current) setSavedFlash(false);
			}, 1500);
			await reloadModels();
			await onChanged();
		} catch (err) {
			pushToast(`保存失败:${(err as Error).message}`, "error");
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!window.confirm(`确定删除 ${provider.name} 的密钥吗?`)) return;
		if (!confirmIfBusy()) return;
		setSaving(true);
		try {
			await window.piApi.removeProviderKey(provider.id);
			pushToast(`${provider.name} 密钥已删除,后端重启后生效`, "info");
			setKeyValue("");
			setOriginalKey("");
			await reloadModels();
			await onChanged();
		} catch (err) {
			pushToast(`删除失败:${(err as Error).message}`, "error");
		} finally {
			setSaving(false);
		}
	};

	const runTest = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			setTestResult(
				await window.piApi.testProviderConnection({
					mode: "models",
					api: provider.api,
					baseUrl: provider.baseUrl,
					apiKey: keyValue.trim() || undefined,
					envVar: provider.envVar,
				}),
			);
		} finally {
			setTesting(false);
		}
	};

	const dirty = keyValue.trim() !== originalKey;
	const canTest = !testing && (provider.source === "env" || !!keyValue.trim());

	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-base font-semibold">{provider.name}</h2>
				<p className="text-xs text-txt2 mt-0.5">{provider.note}</p>
				<div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-txt2 rounded-full bg-side px-2.5 py-1">
					<span className={`w-1.5 h-1.5 rounded-full ${builtinDotColor(provider.source)}`} />
					{provider.source === "env"
						? "密钥来自环境变量"
						: provider.source === "auth"
							? "已配置"
							: "未配置"}
				</div>
			</div>

			{provider.source !== "env" && (
				<div className="space-y-2">
					<SectionLabel>API Key</SectionLabel>
					<KeyInput
						value={keyValue}
						onChange={setKeyValue}
						onSubmit={() => void save()}
						placeholder="粘贴 API Key,如 sk-…"
						autoFocus={provider.source !== "auth"}
					/>
					{provider.source === "auth" && (
						<div className="text-[11px] text-txt2">修改后点保存即更换;点小眼睛切换显隐。</div>
					)}
					<div className="flex items-center gap-2 pt-1">
						<button onClick={() => void save()} disabled={saving || !keyValue.trim() || !dirty} className={btnPrimary}>
							{savedFlash ? "✓ 已保存" : saving ? "保存中…" : "保存"}
						</button>
						<button onClick={() => void runTest()} disabled={!canTest} className={btnGhost}>
							{testing ? (
								<>
									<Spinner /> 测试中…
								</>
							) : (
								"测试连接"
							)}
						</button>
						{provider.source === "auth" && (
							<button onClick={() => void remove()} disabled={saving} className={btnDanger}>
								删除密钥
							</button>
						)}
					</div>
					{testResult && <TestResultBlock result={testResult} />}
				</div>
			)}
		</div>
	);
}

/* ---------------- 自定义 provider 表单 ---------------- */
const API_OPTIONS = [
	{ value: "openai-completions", label: "OpenAI Completions(大多数兼容服务)" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google-generative-ai", label: "Google Generative AI" },
];

interface CustomFormState {
	id: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	/** 每行一个:模型id 或 模型id|显示名 */
	modelsText: string;
	reasoning: boolean;
}

function emptyCustomForm(): CustomFormState {
	return { id: "", baseUrl: "", api: "openai-completions", apiKey: "", modelsText: "", reasoning: false };
}

function formFromProvider(p: CustomProvider): CustomFormState {
	return {
		id: p.id,
		baseUrl: p.baseUrl,
		api: p.api,
		apiKey: p.apiKey ?? "",
		modelsText: p.models.map((m) => (m.name && m.name !== m.id ? `${m.id}|${m.name}` : m.id)).join("\n"),
		reasoning: p.models.some((m) => m.reasoning),
	};
}

function parseModels(text: string, reasoning: boolean): CustomProviderModel[] {
	const seen = new Set<string>();
	const out: CustomProviderModel[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const [id, name] = trimmed.split("|").map((s) => s.trim());
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push({ id, name: name || undefined, reasoning });
	}
	return out;
}

function CustomProviderForm({
	initial,
	originalId,
	onSaved,
	onCancel,
	isNew,
}: {
	initial: CustomFormState;
	/** 编辑时传入原 id(允许改名);新增为 undefined */
	originalId?: string;
	/** 保存成功回调,传回 provider id(父级据此刷新 + 切换选中) */
	onSaved: (id: string) => void;
	/** 仅新建时提供:取消=丢弃,回到列表态 */
	onCancel?: () => void;
	isNew?: boolean;
}) {
	const [form, setForm] = useState(initial);
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
	const pushToast = useSessionStore((s) => s.pushToast);
	const reloadModels = useSessionStore((s) => s.reloadModels);

	const patch = (p: Partial<CustomFormState>) => setForm((f) => ({ ...f, ...p }));
	const valid = form.id.trim() && form.baseUrl.trim() && parseModels(form.modelsText, false).length > 0;

	const save = async () => {
		if (!valid) return;
		if (!confirmIfBusy()) return;
		const models = parseModels(form.modelsText, form.reasoning);
		setSaving(true);
		try {
			const id = form.id.trim();
			await window.piApi.upsertCustomProvider(
				{
					id,
					baseUrl: form.baseUrl.trim(),
					api: form.api,
					apiKey: form.apiKey.trim() || undefined,
					models,
				},
				originalId,
			);
			pushToast(`自定义模型「${id}」已保存,后端重启后生效`, "info");
			await reloadModels();
			onSaved(id);
		} catch (err) {
			pushToast(`保存失败:${(err as Error).message}`, "error");
		} finally {
			setSaving(false);
		}
	};

	const runTest = async () => {
		const first = parseModels(form.modelsText, false)[0]?.id;
		if (!first) return;
		setTesting(true);
		setTestResult(null);
		try {
			setTestResult(
				await window.piApi.testProviderConnection({
					mode: "chat",
					api: form.api,
					baseUrl: form.baseUrl,
					apiKey: form.apiKey,
					model: first,
				}),
			);
		} finally {
			setTesting(false);
		}
	};

	return (
		<div className="space-y-6">
			{/* 连接信息 */}
			<section className="space-y-3">
				<SectionLabel>连接信息</SectionLabel>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className={labelCls}>名称(英文标识,如 my-glm)</label>
						<input
							autoFocus
							value={form.id}
							onChange={(e) => patch({ id: e.target.value })}
							placeholder="my-provider"
							className={inputCls}
						/>
					</div>
					<div>
						<label className={labelCls}>API 类型</label>
						<select value={form.api} onChange={(e) => patch({ api: e.target.value })} className={inputCls}>
							{API_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</div>
				</div>
				<div>
					<label className={labelCls}>Base URL</label>
					<input
						value={form.baseUrl}
						onChange={(e) => patch({ baseUrl: e.target.value })}
						placeholder="https://api.example.com/v1"
						className={inputCls}
					/>
				</div>
				<div>
					<label className={labelCls}>API Key(也可填 $环境变量 引用)</label>
					<KeyInput
						value={form.apiKey}
						onChange={(v) => patch({ apiKey: v })}
						placeholder="sk-… 或 $MY_API_KEY"
					/>
				</div>
			</section>

			{/* 模型列表 */}
			<section className="space-y-3">
				<SectionLabel>模型列表</SectionLabel>
				<div>
					<label className={labelCls}>每行一个,格式:模型id 或 模型id|显示名</label>
					<textarea
						value={form.modelsText}
						onChange={(e) => patch({ modelsText: e.target.value })}
						placeholder={"deepseek-chat|DeepSeek V3\ndeepseek-reasoner|DeepSeek R1"}
						rows={4}
						className={`${inputCls} resize-y font-mono text-xs`}
					/>
				</div>
				<label className="flex items-center gap-2 text-sm cursor-pointer select-none">
					<input
						type="checkbox"
						checked={form.reasoning}
						onChange={(e) => patch({ reasoning: e.target.checked })}
						className="accent-accent"
					/>
					这些模型支持思考(推理)
				</label>
			</section>

			{/* 验证与保存 */}
			<section className="space-y-2">
				<SectionLabel>验证与保存</SectionLabel>
				<div className="flex items-center gap-2 pt-1">
					<button
						onClick={() => void runTest()}
						disabled={testing || saving || !valid}
						className={btnGhost}
					>
						{testing ? (
							<>
								<Spinner /> 测试中…
							</>
						) : (
							"测试连接"
						)}
					</button>
					<button onClick={() => void save()} disabled={saving || !valid} className={btnPrimary}>
						{saving ? "保存中…" : "保存"}
					</button>
					{isNew && onCancel && (
						<button onClick={onCancel} disabled={saving} className={btnGhost}>
							取消
						</button>
					)}
				</div>
				{testResult && (
					<TestResultBlock
						result={testResult}
						okSuffix={`模型 ${parseModels(form.modelsText, false)[0]?.id}`}
					/>
				)}
			</section>
		</div>
	);
}

/* ---------------- 管理页主体 ---------------- */
export default function ModelManagerPage() {
	const open = useSessionStore((s) => s.modelManagerOpen);
	const setOpen = useSessionStore((s) => s.setModelManagerOpen);
	const pushToast = useSessionStore((s) => s.pushToast);
	const reloadModels = useSessionStore((s) => s.reloadModels);
	const activeCwd = useSessionStore((s) => s.activeCwd);
	const activeWsName = useSessionStore(
		(s) => s.workspaces.find((w) => w.cwd === s.activeCwd)?.name ?? s.activeCwd,
	);
	const activeModelName = useSessionStore((s) => s.byCwd[s.activeCwd]?.sessionState?.model?.name);

	const [activeTab, setActiveTab] = useState<Tab>(() => {
		try {
			return localStorage.getItem(TAB_KEY) === "custom" ? "custom" : "builtin";
		} catch {
			return "builtin";
		}
	});
	const [selection, setSelection] = useState<Selection>(null);
	const [query, setQuery] = useState("");
	const [builtins, setBuiltins] = useState<ProviderStatus[]>([]);
	const [customs, setCustoms] = useState<CustomProvider[]>([]);
	const [loading, setLoading] = useState(false);
	const [closing, setClosing] = useState(false);
	const closingRef = useRef(false);
	const closeTimer = useRef<number | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const data = await window.piApi.listProviders();
			setBuiltins(data.builtins);
			setCustoms(data.customs);
		} catch (err) {
			pushToast(`读取提供商配置失败:${(err as Error).message}`, "error");
		} finally {
			setLoading(false);
		}
	}, [pushToast]);

	const requestClose = useCallback(() => {
		if (closingRef.current) return;
		closingRef.current = true;
		setClosing(true);
		closeTimer.current = window.setTimeout(() => {
			closingRef.current = false;
			setClosing(false);
			setOpen(false);
		}, 150);
	}, [setOpen]);

	// 打开时刷新 + Esc 关闭;卸载时清掉退出动画定时器
	useEffect(() => {
		if (open) {
			setQuery("");
			void refresh();
			const onKey = (e: KeyboardEvent) => {
				if (e.key === "Escape") requestClose();
			};
			window.addEventListener("keydown", onKey);
			return () => window.removeEventListener("keydown", onKey);
		}
	}, [open, refresh, requestClose]);

	useEffect(
		() => () => {
			if (closeTimer.current) window.clearTimeout(closeTimer.current);
			closingRef.current = false;
		},
		[],
	);

	// 选择态校验:切标签 / 数据刷新 / 删除后,若选中项不在当前标签列表中则自动选首项
	useEffect(() => {
		if (!open) return;
		if (activeTab === "builtin") {
			const valid = builtins.some((b) => selection?.kind === "builtin" && selection.id === b.id);
			if (!valid) setSelection(builtins.length ? { kind: "builtin", id: builtins[0].id } : null);
		} else {
			const valid =
				selection?.kind === "new-custom" ||
				customs.some((c) => selection?.kind === "custom" && selection.id === c.id);
			if (!valid) setSelection(customs.length ? { kind: "custom", id: customs[0].id } : null);
		}
	}, [open, activeTab, builtins, customs, selection]);

	const switchTab = (tab: Tab) => {
		if (tab === activeTab) return;
		setActiveTab(tab);
		try {
			localStorage.setItem(TAB_KEY, tab);
		} catch {
			/* localStorage 不可用时静默 */
		}
		setQuery("");
		// selection 由上面的校验 effect 自动迁移到新标签首项
	};

	const onCustomSaved = async (id: string) => {
		await refresh();
		setSelection({ kind: "custom", id });
	};

	const removeCustom = async (p: CustomProvider) => {
		if (!window.confirm(`确定删除自定义模型「${p.id}」吗?`)) return;
		if (!confirmIfBusy()) return;
		try {
			await window.piApi.removeCustomProvider(p.id);
			pushToast(`已删除「${p.id}」,后端重启后生效`, "info");
			await reloadModels();
			await refresh();
			// 若删的正是选中项,校验 effect 会自动迁移到首项
		} catch (err) {
			pushToast(`删除失败:${(err as Error).message}`, "error");
		}
	};

	if (!open) return null;

	// 当前选中对象(按 id 从最新数据解析)
	const selectedBuiltin =
		selection?.kind === "builtin" ? builtins.find((b) => b.id === selection.id) : undefined;
	const selectedCustom =
		selection?.kind === "custom" ? customs.find((c) => c.id === selection.id) : undefined;
	const isNewCustom = selection?.kind === "new-custom";
	const hasDetail = selectedBuiltin || selectedCustom || isNewCustom;

	// 搜索过滤(仅过滤当前标签列表)
	const q = query.trim().toLowerCase();
	const filteredBuiltins = q
		? builtins.filter((b) => `${b.name} ${b.id}`.toLowerCase().includes(q))
		: builtins;
	const filteredCustoms = q
		? customs.filter((c) => `${c.id} ${c.baseUrl}`.toLowerCase().includes(q))
		: customs;
	const configuredBuiltinCount = builtins.filter((b) => b.configured).length;

	return (
		<div className={`fixed inset-0 z-40 bg-ground flex flex-col ${closing ? "page-exit" : "animate-page"}`}>
			{/* 头部:返回 + 标题 + 当前上下文 */}
			<header className="shrink-0 flex items-center gap-3 px-5 h-12 border-b border-sep">
				<button
					onClick={requestClose}
					className="btn-press flex items-center gap-1.5 h-7 rounded-lg px-2.5 text-sm text-txt2 hover:text-txt hover:bg-side transition-colors duration-150"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<path d="M15 18l-6-6 6-6" />
					</svg>
					返回
				</button>
				<h1 className="text-sm font-semibold">模型与密钥</h1>
				<div className="flex-1" />
				{activeCwd && (
					<span
						className="text-[11px] text-txt2 bg-side rounded-full px-2.5 py-1 truncate max-w-[280px]"
						title={`${activeWsName} · ${activeModelName ?? "未选择模型"}`}
					>
						{activeWsName} · {activeModelName ?? "未选择模型"}
					</span>
				)}
			</header>

			<div className="flex-1 flex min-h-0">
				{/* ---------------- 左列:标签 + 搜索 + 列表 ---------------- */}
				<aside className="w-[300px] shrink-0 border-r border-sep flex flex-col bg-side">
					{/* 分段标签:内置 / 自定义(计数格式统一) */}
					<div className="flex p-1.5 gap-1 border-b border-sep">
						<button
							onClick={() => switchTab("builtin")}
							className={`flex-1 h-8 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors duration-150 ${
								activeTab === "builtin"
									? "bg-card shadow-sm text-accent"
									: "text-txt2 hover:text-txt hover:bg-card/60"
							}`}
						>
							内置
							<span className="text-[10px] opacity-80 tabular-nums">
								{configuredBuiltinCount}/{builtins.length}
							</span>
						</button>
						<button
							onClick={() => switchTab("custom")}
							className={`flex-1 h-8 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors duration-150 ${
								activeTab === "custom"
									? "bg-card shadow-sm text-accent"
									: "text-txt2 hover:text-txt hover:bg-card/60"
							}`}
						>
							自定义
							<span className="text-[10px] opacity-80 tabular-nums">({customs.length})</span>
						</button>
					</div>

					{/* 搜索 */}
					<div className="p-2 border-b border-sep">
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder={activeTab === "builtin" ? "搜索提供商…" : "搜索自定义模型…"}
							className={inputCls}
						/>
					</div>

					{/* 列表 */}
					<div className="flex-1 overflow-y-auto px-1.5 py-1.5">
						{loading && builtins.length === 0 && customs.length === 0 && (
							<div className="px-2 py-4 flex items-center gap-2 text-xs text-txt2">
								<Spinner /> 加载中…
							</div>
						)}

						{activeTab === "builtin" ? (
							filteredBuiltins.length === 0 ? (
								<div className="px-3 py-8 text-center text-xs text-txt2">无匹配提供商</div>
							) : (
								filteredBuiltins.map((b) => {
									const active = selectedBuiltin?.id === b.id;
									return (
										<button
											key={b.id}
											onClick={() => setSelection({ kind: "builtin", id: b.id })}
											className={`w-full text-left rounded-lg px-2.5 py-2 border-l-2 transition-colors duration-150 ${
												active
													? "border-accent bg-accent-soft text-accent"
													: "border-transparent text-txt hover:bg-card/60"
											}`}
										>
											<div className="flex items-center gap-2 min-w-0">
												<span className={`w-2 h-2 rounded-full shrink-0 ${builtinDotColor(b.source)}`} />
												<span className="flex-1 min-w-0 truncate text-sm">{b.name}</span>
												{b.configured && (
													<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-green">
														<polyline points="20 6 9 17 4 12" />
													</svg>
												)}
											</div>
											<div className="text-[10px] text-txt2 truncate pl-4 mt-0.5">{b.note}</div>
										</button>
									);
								})
							)
						) : (
							<>
								{/* 新建入口 */}
								<button
									onClick={() => setSelection({ kind: "new-custom" })}
									className={`w-full text-left rounded-lg px-2.5 py-2 border-l-2 transition-colors duration-150 ${
										isNewCustom
											? "border-accent bg-accent-soft text-accent"
											: "border-transparent text-accent hover:bg-card/60"
									}`}
								>
									<div className="flex items-center gap-2">
										<span className="w-2 h-2 shrink-0" />
										<span className="text-sm">+ 新建自定义模型</span>
									</div>
								</button>

								{filteredCustoms.length === 0 ? (
									!q ? (
										<div className="px-3 py-8 flex flex-col items-center text-center text-txt2">
											<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
												<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
												<polyline points="3.27 6.96 12 12.01 20.73 6.96" />
												<line x1="12" y1="22.08" x2="12" y2="12" />
											</svg>
											<p className="text-xs mt-2">还没有自定义模型</p>
											<p className="text-[10px] mt-1">添加一个 OpenAI / Anthropic / Google 兼容端点</p>
										</div>
									) : (
										<div className="px-3 py-8 text-center text-xs text-txt2">无匹配项</div>
									)
								) : (
									filteredCustoms.map((c) => {
										const active = selectedCustom?.id === c.id;
										return (
											<button
												key={c.id}
												onClick={() => setSelection({ kind: "custom", id: c.id })}
												className={`w-full text-left rounded-lg px-2.5 py-2 border-l-2 transition-colors duration-150 ${
													active
														? "border-accent bg-accent-soft text-accent"
														: "border-transparent text-txt hover:bg-card/60"
												}`}
											>
												<div className="flex items-center gap-2 min-w-0">
													<span
														className={`w-2 h-2 rounded-full shrink-0 ${active ? "bg-accent" : "bg-txt2/40"}`}
													/>
													<span className="flex-1 min-w-0 truncate text-sm">{c.id}</span>
												</div>
												<div className="text-[10px] text-txt2 truncate pl-4 mt-0.5">{c.baseUrl}</div>
											</button>
										);
									})
								)}
							</>
						)}
					</div>
				</aside>

				{/* ---------------- 右列:详情/编辑面 ---------------- */}
				<section className="flex-1 overflow-y-auto">
					<div className="max-w-3xl mx-auto px-8 py-6">
						{selectedBuiltin && (
							<div className="bg-card border border-sep rounded-xl p-5">
								<BuiltinDetail key={selectedBuiltin.id} provider={selectedBuiltin} onChanged={refresh} />
							</div>
						)}

						{selectedCustom && (
							<div className="bg-card border border-sep rounded-xl p-5">
								<div className="flex items-center gap-2 mb-5">
									<h2 className="text-base font-semibold flex-1 min-w-0 truncate">{selectedCustom.id}</h2>
									<button
										onClick={() => void removeCustom(selectedCustom)}
										className="btn-press h-7 rounded-lg px-2.5 text-xs text-red hover:bg-red/10"
									>
										删除
									</button>
								</div>
								<CustomProviderForm
									key={selectedCustom.id}
									initial={formFromProvider(selectedCustom)}
									originalId={selectedCustom.id}
									onSaved={onCustomSaved}
								/>
							</div>
						)}

						{isNewCustom && (
							<div className="bg-card border border-sep rounded-xl p-5">
								<h2 className="text-base font-semibold mb-5">新建自定义模型</h2>
								<CustomProviderForm
									key="new"
									initial={emptyCustomForm()}
									onSaved={onCustomSaved}
									onCancel={() => setSelection(selectFirst("custom", builtins, customs))}
									isNew
								/>
							</div>
						)}

						{!hasDetail && (
							<div className="pt-28 flex flex-col items-center text-txt2">
								<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 mb-3">
									<path d="M15 7h3a5 5 0 0 1 0 10h-3" />
									<path d="M9 17H6a5 5 0 0 1 0-10h3" />
									<line x1="8" y1="12" x2="16" y2="12" />
								</svg>
								<p className="text-sm">
									{activeTab === "custom" ? "从左侧选择或新建自定义模型" : "从左侧选择一个提供商配置密钥"}
								</p>
							</div>
						)}
					</div>
				</section>
			</div>
		</div>
	);
}
