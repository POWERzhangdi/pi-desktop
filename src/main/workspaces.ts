/**
 * workspace 注册表:手动添加(config.json workspaces) ∪ 会话目录发现
 * (会话 header.cwd 去重)− 删除(hiddenWorkspaces);归档(archivedWorkspaces)
 * 收进"已归档"区,可恢复。
 *
 * 注意:不做会话目录名 → cwd 的反转义(转义不可逆,含 `-` 的目录名会歧义),
 * cwd 真实值一律取自会话文件 header。
 *
 * config.json 的读写统一走 ConfigStore(原子写 + 单一 owner)。
 */
import type { WorkspaceInfo } from "../shared/ipc";
import { scanSessions } from "./sessions/scanner";
import { configStore } from "./config/store";

/** cwd 最后一段作为显示名 */
function baseName(cwd: string): string {
	const parts = cwd.split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] ?? cwd;
}

/** 只保留字符串数组里的字符串项(防止手改配置写进非法值) */
function strings(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** 列出 workspace:手动 ∪ 发现 − 删除;活跃区按最近活跃倒序,归档区排最后 */
export async function listWorkspaces(sessionsDir: string): Promise<WorkspaceInfo[]> {
	const cfg = configStore.read();
	const manual = strings(cfg.workspaces);
	const hidden = new Set(strings(cfg.hiddenWorkspaces));
	const archived = new Set(strings(cfg.archivedWorkspaces));

	// 会话扫描:按 cwd 聚合数量与最近活跃时间
	const sessions = await scanSessions(sessionsDir);
	const byCwd = new Map<string, { count: number; lastActiveMs: number }>();
	for (const s of sessions) {
		if (!s.cwd) continue;
		const agg = byCwd.get(s.cwd) ?? { count: 0, lastActiveMs: 0 };
		agg.count += 1;
		agg.lastActiveMs = Math.max(agg.lastActiveMs, s.mtimeMs);
		byCwd.set(s.cwd, agg);
	}

	const result: WorkspaceInfo[] = [];
	const seen = new Set<string>();
	const push = (cwd: string, source: WorkspaceInfo["source"]) => {
		if (seen.has(cwd) || hidden.has(cwd)) return;
		seen.add(cwd);
		const agg = byCwd.get(cwd);
		result.push({
			cwd,
			name: baseName(cwd),
			source,
			archived: archived.has(cwd),
			sessionCount: agg?.count ?? 0,
			lastActiveMs: agg?.lastActiveMs ?? 0,
		});
	};
	for (const cwd of manual) push(cwd, "manual");
	for (const cwd of byCwd.keys()) push(cwd, "discovered");

	// 活跃区按最近活跃倒序在前,归档区在后(区内同样按时间倒序)
	result.sort((a, b) => Number(a.archived) - Number(b.archived) || b.lastActiveMs - a.lastActiveMs);
	return result;
}

/** 注册新 workspace(幂等);若曾被删除/归档则解除 */
export function addWorkspace(cwd: string): void {
	const cfg = configStore.read();
	const workspaces = strings(cfg.workspaces);
	if (!workspaces.includes(cwd)) workspaces.push(cwd);
	configStore.patch({
		workspaces,
		hiddenWorkspaces: strings(cfg.hiddenWorkspaces).filter((c) => c !== cwd),
		archivedWorkspaces: strings(cfg.archivedWorkspaces).filter((c) => c !== cwd),
	});
}

/** 归档:收进"已归档"区(可恢复) */
export function archiveWorkspace(cwd: string): void {
	const archived = new Set(strings(configStore.read().archivedWorkspaces));
	archived.add(cwd);
	configStore.patch({ archivedWorkspaces: [...archived] });
}

/** 恢复:从归档区移回活跃区 */
export function restoreWorkspace(cwd: string): void {
	configStore.patch({
		archivedWorkspaces: strings(configStore.read().archivedWorkspaces).filter((c) => c !== cwd),
	});
}

/** 删除:手动项从列表删除;统一加入隐藏列表(发现项只能重新手动添加找回) */
export function removeWorkspace(cwd: string): void {
	const cfg = configStore.read();
	const hidden = new Set(strings(cfg.hiddenWorkspaces));
	hidden.add(cwd);
	configStore.patch({
		workspaces: strings(cfg.workspaces).filter((c) => c !== cwd),
		hiddenWorkspaces: [...hidden],
		archivedWorkspaces: strings(cfg.archivedWorkspaces).filter((c) => c !== cwd),
	});
}
