/**
 * 每个 workspace 的模型/思考等级偏好(localStorage 持久化)。
 * 进程懒启动后由 store.setActive 自动恢复;用户手动切换时更新。
 */

export interface ModelPref {
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
}

const STORAGE_KEY = "pi-desktop-model-pref";

type PrefMap = Record<string, ModelPref>;

export function loadModelPrefs(): PrefMap {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as PrefMap) : {};
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** 合并写入某个 workspace 的偏好(可只更新部分字段) */
export function saveModelPref(cwd: string, patch: ModelPref): void {
	if (!cwd) return;
	try {
		const prefs = loadModelPrefs();
		prefs[cwd] = { ...prefs[cwd], ...patch };
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		/* localStorage 不可用时静默 */
	}
}
