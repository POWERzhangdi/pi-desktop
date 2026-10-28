/**
 * 内置插件服务:把 extensions/bundled 同步到 ~/.pi/agent/extensions/ 并预装依赖。
 *
 * 注意:pi 启动即加载全部扩展,缺依赖会让 pi 直接退出,所以依赖必须在
 * 第一条命令前就位。但 npm install 可能很慢甚至离线 —— 给一个上限,
 * 超时先放行(pi 自己会报清晰的缺模块错误),不让 UI 无限转圈。
 */
import { app } from "electron";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensurePluginDeps, syncBundledPlugins } from "../plugins";
import { withTimeout } from "../util/async";

/** 首次命令前等待插件准备的上限 */
const PREPARE_TIMEOUT_MS = 60_000;

export class PluginsService {
	private readonly destDir = join(homedir(), ".pi", "agent", "extensions");
	private sync: Promise<string[]> | null = null;

	private get sourceDir(): string {
		return app.isPackaged
			? join(process.resourcesPath, "extensions", "bundled")
			: join(app.getAppPath(), "extensions", "bundled");
	}

	/** 同步文件 + 预装依赖(幂等,失败允许下次重试) */
	ensure(): Promise<string[]> {
		if (!this.sync) {
			this.sync = Promise.resolve()
				.then(() => syncBundledPlugins(this.sourceDir, this.destDir, app.getVersion()))
				.then((changed) =>
					this.installAllDeps().then(() => changed),
				);
			this.sync.catch(() => {
				this.sync = null;
			});
		}
		return this.sync;
	}

	/** 第一条命令前调用:限时等待,失败/超时都不阻塞(由 pi 自己报错) */
	async ensureBeforeCommand(): Promise<void> {
		try {
			await withTimeout(this.ensure(), PREPARE_TIMEOUT_MS, "内置插件准备");
		} catch (err) {
			console.error("[plugins] 准备超时或失败,继续启动:", err);
		}
	}

	/** 为所有内置插件(顶层目录)预装 npm 依赖,并发且幂等 */
	private installAllDeps(): Promise<void> {
		let names: string[] = [];
		try {
			names = readdirSync(this.sourceDir, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name);
		} catch {
			return Promise.resolve();
		}
		return Promise.all(
			names.map((name) => ensurePluginDeps(this.destDir, name).catch(() => {})),
		).then(() => undefined);
	}
}
