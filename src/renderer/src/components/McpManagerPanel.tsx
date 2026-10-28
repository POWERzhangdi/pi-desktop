/**
 * MCP 服务器管理面板(列表 + 新增/编辑表单 + 测试连接)。
 * 复用点:全屏管理页(McpManagerPage)与设置面板的"MCP 服务器"tab 共用。
 */
import { useEffect, useState } from "react";
import { useMcpStore } from "../store/useMcpStore";
import { confirmAction } from "../store/confirm";
import type { McpServerConfig, McpTestResult } from "../../../shared/ipc";

import { Spinner, inputCls, labelCls } from "./ui";

/* ---------------- 表单 ---------------- */

interface EnvRow {
	key: string;
	value: string;
	hidden: boolean;
}

interface FormState {
	id: string;
	name: string;
	transport: "stdio" | "http";
	command: string;
	args: string;
	cwd: string;
	url: string;
	envRows: EnvRow[];
	enabled: boolean;
}

function formFromServer(server?: McpServerConfig): FormState {
	return {
		id: server?.id ?? "",
		name: server?.name ?? "",
		transport: server?.transport ?? "stdio",
		command: server?.command ?? "",
		args: server?.args?.join("\n") ?? "",
		cwd: server?.cwd ?? "",
		url: server?.url ?? "",
		envRows: Object.entries(server?.env ?? {}).map(([key, value]) => ({
			key,
			value,
			hidden: true,
		})),
		enabled: server?.enabled ?? true,
	};
}

function toServerConfig(f: FormState): McpServerConfig {
	const env: Record<string, string> = {};
	for (const row of f.envRows) {
		const key = row.key.trim();
		if (key) env[key] = row.value;
	}
	return {
		id: f.id.trim(),
		name: f.name.trim(),
		transport: f.transport,
		command: f.transport === "stdio" ? f.command.trim() : undefined,
		args:
			f.transport === "stdio"
				? f.args
						.split("\n")
						.map((s) => s.trim())
						.filter(Boolean)
				: undefined,
		cwd: f.cwd.trim() || undefined,
		url: f.transport === "http" ? f.url.trim() : undefined,
		env: Object.keys(env).length > 0 ? env : undefined,
		enabled: f.enabled,
	};
}

function McpForm({
	initial,
	existingIds,
	onCancel,
	onSaved,
}: {
	initial?: McpServerConfig;
	existingIds: string[];
	onCancel: () => void;
	onSaved: () => void;
}) {
	const save = useMcpStore((s) => s.save);
	const test = useMcpStore((s) => s.test);
	const [f, setF] = useState<FormState>(() => formFromServer(initial));
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<McpTestResult | null>(null);

	const patch = (p: Partial<FormState>) => {
		setF((prev) => ({ ...prev, ...p }));
		setErrors({});
	};

	const validate = (): Record<string, string> => {
		const e: Record<string, string> = {};
		if (!f.name.trim()) e.name = "请填写名称";
		if (!f.id.trim()) e.id = "请填写 id";
		else if (!/^[a-zA-Z0-9_-]+$/.test(f.id.trim())) e.id = "只能包含字母/数字/下划线/中划线";
		else if (!initial && existingIds.includes(f.id.trim())) e.id = "该 id 已存在";
		if (f.transport === "stdio" && !f.command.trim()) e.command = "请填写启动命令(如 npx / node)";
		if (f.transport === "http" && !f.url.trim()) e.url = "请填写 URL";
		return e;
	};

	const buildAndTest = async () => {
		const e = validate();
		if (Object.keys(e).length > 0) {
			setErrors(e);
			return;
		}
		setTesting(true);
		setTestResult(null);
		try {
			setTestResult(await test(toServerConfig(f)));
		} finally {
			setTesting(false);
		}
	};

	const doSave = async () => {
		const e = validate();
		if (Object.keys(e).length > 0) {
			setErrors(e);
			return;
		}
		setSaving(true);
		try {
			const ok = await save(toServerConfig(f), initial?.id);
			if (ok) onSaved();
		} finally {
			setSaving(false);
		}
	};

	const err = (k: string) =>
		errors[k] ? <p className="text-[11px] text-red mt-1">{errors[k]}</p> : null;

	return (
		<div className="border border-accent/40 rounded-xl p-4 bg-accent-soft/40 space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold">{initial ? `编辑 ${initial.name}` : "新增 MCP 服务器"}</h3>
				<button
					onClick={onCancel}
					className="btn-press w-6 h-6 flex items-center justify-center text-txt2 hover:text-txt"
					title="取消"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
				</button>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<div>
					<label className={labelCls}>名称</label>
					<input
						value={f.name}
						onChange={(e) => patch({ name: e.target.value })}
						placeholder="如:数据库、GitHub"
						className={inputCls}
					/>
					{err("name")}
				</div>
				<div>
					<label className={labelCls}>id(工具名前缀 mcp_&lt;id&gt;_ 来源)</label>
					<input
						value={f.id}
						onChange={(e) => patch({ id: e.target.value })}
						disabled={!!initial}
						placeholder="如:db"
						className={`${inputCls} disabled:opacity-50`}
					/>
					{err("id")}
				</div>
			</div>

			<div>
				<label className={labelCls}>传输类型</label>
				<div className="flex gap-2">
					{(["stdio", "http"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => {
								patch({ transport: t });
								setTestResult(null);
							}}
							className={`flex-1 text-sm rounded-lg border px-3 py-1.5 transition-colors ${
								f.transport === t
									? "border-accent bg-accent-soft text-accent"
									: "border-sep text-txt2 hover:bg-side"
							}`}
						>
							{t === "stdio" ? "stdio(本地进程)" : "http(远程 URL)"}
						</button>
					))}
				</div>
			</div>

			{f.transport === "stdio" ? (
				<>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className={labelCls}>启动命令</label>
							<input
								value={f.command}
								onChange={(e) => patch({ command: e.target.value })}
								placeholder="npx / node / python…"
								className={inputCls}
							/>
							{err("command")}
						</div>
						<div>
							<label className={labelCls}>工作目录(可选)</label>
							<input
								value={f.cwd}
								onChange={(e) => patch({ cwd: e.target.value })}
								placeholder="留空继承 pi 的工作区"
								className={inputCls}
							/>
						</div>
					</div>
					<div>
						<label className={labelCls}>参数(一行一个)</label>
						<textarea
							value={f.args}
							onChange={(e) => patch({ args: e.target.value })}
							rows={2}
							placeholder={"-y\n@modelcontextprotocol/server-filesystem\nC:/data"}
							className={`${inputCls} resize-y font-mono`}
						/>
					</div>
				</>
			) : (
				<div>
					<label className={labelCls}>URL(Streamable HTTP / SSE)</label>
					<input
						value={f.url}
						onChange={(e) => patch({ url: e.target.value })}
						placeholder="http://localhost:8000/mcp"
						className={inputCls}
					/>
					{err("url")}
				</div>
			)}

			<div>
				<label className={labelCls}>环境变量(可放密钥)</label>
				<div className="space-y-1.5">
					{f.envRows.map((row, i) => (
						<div key={i} className="flex items-center gap-2">
							<input
								value={row.key}
								onChange={(e) =>
									patch({
										envRows: f.envRows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)),
									})
								}
								placeholder="KEY"
								className={`${inputCls} w-40 font-mono`}
							/>
							<div className="relative flex-1">
								<input
									type={row.hidden ? "password" : "text"}
									value={row.value}
									onChange={(e) =>
										patch({
											envRows: f.envRows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
										})
									}
									placeholder="VALUE"
									className={`${inputCls} pr-8 font-mono`}
								/>
								<button
									type="button"
									onClick={() =>
										patch({
											envRows: f.envRows.map((r, j) => (j === i ? { ...r, hidden: !r.hidden } : r)),
										})
									}
									title={row.hidden ? "显示" : "隐藏"}
									className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-txt2 hover:text-txt"
								>
									{row.hidden ? (
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
									) : (
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
									)}
								</button>
							</div>
							<button
								type="button"
								onClick={() => patch({ envRows: f.envRows.filter((_, j) => j !== i) })}
								title="删除"
								className="btn-press w-6 h-6 flex items-center justify-center text-txt2 hover:text-red shrink-0"
							>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
							</button>
						</div>
					))}
					<button
						type="button"
						onClick={() => patch({ envRows: [...f.envRows, { key: "", value: "", hidden: true }] })}
						className="text-xs text-accent hover:underline btn-press"
					>
						+ 添加环境变量
					</button>
				</div>
			</div>

			<label className="flex items-center gap-1.5 text-xs text-txt2 cursor-pointer select-none">
				<input
					type="checkbox"
					checked={f.enabled}
					onChange={(e) => patch({ enabled: e.target.checked })}
					className="accent-accent w-3.5 h-3.5"
				/>
				启用(保存并重启后连接)
			</label>

			{testResult && (
				<div
					className={`text-xs rounded-lg px-3 py-2 ${
						testResult.ok
							? "bg-green/10 text-green"
							: "bg-red/10 text-red break-all whitespace-pre-wrap"
					}`}
				>
					{testResult.ok
						? `✓ 连接成功,发现 ${testResult.toolCount} 个工具`
						: `✗ ${testResult.error ?? "连接失败"}`}
				</div>
			)}

			<div className="flex items-center justify-end gap-2 pt-1">
				<button
					onClick={() => void buildAndTest()}
					disabled={testing || saving}
					className="btn-press text-xs border border-sep rounded-lg px-3 py-1.5 text-txt2 hover:text-txt hover:bg-side disabled:opacity-50 inline-flex items-center gap-1.5"
				>
					{testing ? <Spinner /> : null}
					{testing ? "测试中…" : "测试连接"}
				</button>
				<button
					onClick={onCancel}
					disabled={saving}
					className="btn-press text-xs text-txt2 border border-sep rounded-lg px-3 py-1.5 hover:text-txt"
				>
					取消
				</button>
				<button
					onClick={() => void doSave()}
					disabled={saving || testing}
					className="btn-press text-xs bg-accent text-white rounded-lg px-4 py-1.5 hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
				>
					{saving ? <Spinner /> : null}
					{saving ? "保存中…" : "保存并重启后端"}
				</button>
			</div>
		</div>
	);
}

/* ---------------- 列表项 ---------------- */

function ServerCard({
	server,
	onEdit,
}: {
	server: McpServerConfig;
	onEdit: () => void;
}) {
	const remove = useMcpStore((s) => s.remove);
	const save = useMcpStore((s) => s.save);
	const test = useMcpStore((s) => s.test);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<McpTestResult | null>(null);

	const detail =
		server.transport === "stdio"
			? [server.command, ...(server.args ?? [])].join(" ")
			: server.url ?? "";

	const runTest = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			setTestResult(await test(server));
		} finally {
			setTesting(false);
		}
	};

	const toggleEnabled = () => void save({ ...server, enabled: !server.enabled }, server.id);

	const doRemove = async () => {
		const ok = await confirmAction({
			title: `删除 MCP 服务器「${server.name}」?`,
			message: "删除后会重启全部后端,该服务器提供的工具将立即不可用。",
			confirmText: "删除",
			danger: true,
		});
		if (ok) await remove(server.id);
	};

	return (
		<div className="border border-sep rounded-xl p-3 bg-card transition-colors hover:border-txt2/25">
			<div className="flex items-center gap-2 min-w-0">
				<span
					className={`w-2 h-2 rounded-full shrink-0 ${server.enabled ? "bg-green" : "bg-txt2/40"}`}
				/>
				<span className="text-sm font-medium truncate">{server.name}</span>
				<span
					className={`text-[10px] rounded px-1.5 py-0.5 shrink-0 ${
						server.transport === "http"
							? "bg-purple/15 text-purple"
							: "bg-accent/15 text-accent"
					}`}
				>
					{server.transport}
				</span>
				{!server.enabled && <span className="text-[10px] text-txt2 shrink-0">未启用</span>}
				{server.env && Object.keys(server.env).length > 0 && (
					<span className="text-[10px] text-txt2/70 shrink-0" title={Object.keys(server.env).join(", ")}>
						{Object.keys(server.env).length} 个环境变量
					</span>
				)}
				<div className="flex-1" />
				<label className="flex items-center gap-1 text-[11px] text-txt2 cursor-pointer select-none shrink-0">
					<input
						type="checkbox"
						checked={server.enabled}
						onChange={toggleEnabled}
						className="accent-accent w-3.5 h-3.5"
					/>
					启用
				</label>
				<button
					onClick={() => void runTest()}
					disabled={testing}
					title="测试连接"
					className="btn-press shrink-0 w-6 h-6 flex items-center justify-center text-txt2 hover:text-accent disabled:opacity-50"
				>
					{testing ? (
						<Spinner />
					) : (
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
					)}
				</button>
				<button
					onClick={onEdit}
					title="编辑"
					className="btn-press shrink-0 w-6 h-6 flex items-center justify-center text-txt2 hover:text-accent"
				>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
				</button>
				<button
					onClick={() => void doRemove()}
					title="删除"
					className="btn-press shrink-0 w-6 h-6 flex items-center justify-center text-txt2 hover:text-red"
				>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
				</button>
			</div>
			{detail && (
				<div className="text-xs font-mono text-txt2 truncate mt-1.5 pl-4" title={detail}>
					{detail}
				</div>
			)}
			{testResult && (
				<div
					className={`text-xs mt-1.5 pl-4 ${
						testResult.ok
							? "text-green"
							: "text-red break-all whitespace-pre-wrap"
					}`}
				>
					{testResult.ok
						? `✓ 连接成功 · ${testResult.toolCount} 个工具`
						: `✗ ${testResult.error ?? "连接失败"}`}
				</div>
			)}
		</div>
	);
}

/* ---------------- 面板 ---------------- */

export default function McpManagerPanel() {
	const servers = useMcpStore((s) => s.servers);
	const load = useMcpStore((s) => s.load);
	const [form, setForm] = useState<
		{ mode: "create" } | { mode: "edit"; server: McpServerConfig } | null
	>(null);

	useEffect(() => {
		void load();
	}, [load]);

	const existingIds = servers.map((s) => s.id);

	return (
		<div className="space-y-3">
			<p className="text-[11px] text-txt2/70 leading-relaxed">
				MCP 服务器拥有与 pi 相同的系统权限,只连接可信来源。配置由 MCP 扩展在 pi 启动时读取,
				保存后重启全部后端生效。工具将以 <code className="font-mono">mcp_&lt;id&gt;_&lt;tool&gt;</code> 形式注册。
			</p>

			{form && (
				<McpForm
					initial={form.mode === "edit" ? form.server : undefined}
					existingIds={existingIds}
					onCancel={() => setForm(null)}
					onSaved={() => setForm(null)}
				/>
			)}

			{servers.length === 0 && !form && (
				<div className="border border-dashed border-sep rounded-xl px-4 py-8 text-center text-txt2">
					<div className="text-2xl mb-1">🔌</div>
					<p className="text-sm">还没有配置 MCP 服务器</p>
					<p className="text-xs mt-1">点击下方按钮添加第一个,如文件系统、数据库、GitHub 等 MCP server。</p>
				</div>
			)}

			{servers.map((s) => (
				<ServerCard key={s.id} server={s} onEdit={() => setForm({ mode: "edit", server: s })} />
			))}

			{!form && (
				<button
					onClick={() => setForm({ mode: "create" })}
					className="btn-press w-full text-sm border border-dashed border-sep rounded-xl py-2.5 text-txt2 hover:text-accent hover:border-accent/50 transition-colors"
				>
					+ 添加 MCP 服务器
				</button>
			)}
		</div>
	);
}
