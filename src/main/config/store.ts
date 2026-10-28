/**
 * ~/.pi-desktop/config.json 的唯一读写入口。
 *
 * 之前这份文件有两个写入口(client.ts 与 workspaces.ts),merge 语义还不一致,
 * 容易出现"加工作区把别的字段冲掉"这类问题。现在统一走这里:
 * - 读:失败一律回退 {}
 * - 写:合并后原子替换(tmp + rename)
 * - 解析:env > config > 自动检测 > 内置兜底(结果带来源,供设置面板展示)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PiConfig, RuntimeSource } from "../../shared/ipc";
import { readJsonFile, writeJsonAtomic } from "../util/json-file";
import { configFilePath, detectGlobalCliPath, detectNodePath, resolveBundledCliPath } from "./paths";

/** config.json 的字段(未知字段读进来后原样保留,写回时不会丢) */
export interface AppConfig {
	nodePath?: string;
	cliPath?: string;
	sessionsDir?: string;
	cwd?: string;
	pythonPath?: string;
	workspaces?: string[];
	hiddenWorkspaces?: string[];
	archivedWorkspaces?: string[];
}

export class ConfigStore {
	read(): AppConfig {
		return readJsonFile<AppConfig>(configFilePath(), {});
	}

	/** 合并写入:只覆盖传入字段,其余原样保留(原子替换) */
	patch(patch: Partial<AppConfig>): void {
		writeJsonAtomic(configFilePath(), { ...this.read(), ...patch });
	}

	/** 解析最终运行配置:环境变量 > 配置文件 > 自动检测 > 内置兜底 */
	resolve(): PiConfig {
		const file = this.read();
		const home = homedir();
	
	

		// --- node:env/config 显式 > 自动检测 > 缺失(绝不退化成裸 "node",spawn 会 ENOENT) ---
		let nodePath = process.env.PI_DESKTOP_NODE || file.nodePath || "";
		let nodeSource: RuntimeSource;
		if (process.env.PI_DESKTOP_NODE) {
			nodeSource = "env";
		} else if (file.nodePath) {
			nodeSource = "config";
		} else {
			nodePath = detectNodePath();
			nodeSource = nodePath ? "detected" : "missing";
		}

		// --- pi cli:env/config 显式 > 全局安装检测 > 内置兜底 ---
		let cliPath = process.env.PI_DESKTOP_CLI || file.cliPath || "";
		let cliSource: RuntimeSource = "missing";
		if (cliPath) {
			cliSource = process.env.PI_DESKTOP_CLI ? "env" : "config";
		} else {
			const detectedCli = detectGlobalCliPath(nodePath);
			const bundledCli = resolveBundledCliPath();
			cliPath = detectedCli || bundledCli;
			if (cliPath) cliSource = detectedCli ? "detected" : "bundled";
		}

		const sessionsDir = file.sessionsDir || join(home, ".pi", "agent", "sessions");
		// 兜底 cwd:未配置时用 ~/projects;不存在则自动创建,避免 spawn 因 cwd 缺失 ENOENT
		const cwd = file.cwd || join(home, "projects");
		try {
			mkdirSync(cwd, { recursive: true });
		} catch {
			/* 目录创建失败不阻塞配置解析 */
		}

		return {
			nodePath,
			cliPath,
			sessionsDir,
			cwd,
			pythonPath: file.pythonPath,
			runtimeInfo: {
				node: { path: nodePath, source: nodeSource },
				cli: { path: cliPath, source: cliSource },
			},
		};
	}
}

/** 全局单例(设置面板的写入与 pool 的读取都走它) */
export const configStore = new ConfigStore();

/** 兼容旧调用点 */
export function resolveConfig(): PiConfig {
	return configStore.resolve();
}

/** 兼容旧调用点:合并写 config.json */
export function writeConfigFile(patch: Partial<PiConfig>): void {
	const { nodePath, cliPath, sessionsDir, cwd, pythonPath } = patch;
	configStore.patch({
		...(nodePath !== undefined ? { nodePath } : {}),
		...(cliPath !== undefined ? { cliPath } : {}),
		...(sessionsDir !== undefined ? { sessionsDir } : {}),
		...(cwd !== undefined ? { cwd } : {}),
		...(pythonPath !== undefined ? { pythonPath } : {}),
	});
}
