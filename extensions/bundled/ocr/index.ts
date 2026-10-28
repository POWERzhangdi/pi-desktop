/**
 * pi 扩展:OCR + 视觉升级。
 *
 * 注册两个工具:
 *  - ocr:用 tesseract.js 识别图片中的文字(默认 chi_sim+eng),结果落盘到固定产物目录。
 *       适用于截图、照片、read_pdf 导出的扫描页图片。组合拳的第二步。
 *  - view_image:opt-in 视觉升级。把图片作为用户消息注入对话,让多模态 LLM 直接看。
 *       仅当当前模型支持图片输入时才注入;否则提示切换多模态模型。token 由用户拍板。
 *
 * 产物目录:~/.pi/agent/artifacts/<sessionId>/ocr/<图片名>-<hash8>/{result.txt,meta.json}
 * tesseract 语言数据缓存:~/.pi/agent/tessdata/(首次联网下载,之后复用)
 *
 * 依赖:tesseract.js。typebox / @earendil-works/pi-coding-agent 由 pi 运行时提供。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as Tesseract from "tesseract.js";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve, isAbsolute, join, extname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const MAX_BYTES = 50_000;
const MAX_LINES = 2000;
const TESS_LANG_DEFAULT = "chi_sim+eng";
const IMAGE_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif",
]);

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".tiff": "image/tiff", ".tif": "image/tiff",
};

function home(): string {
  return process.env.USERPROFILE || process.env.HOME || homedir();
}
function artifactsRoot(): string {
  return process.env.PI_ARTIFACTS_DIR || join(home(), ".pi", "agent", "artifacts");
}
function tessDir(): string {
  return join(home(), ".pi", "agent", "tessdata");
}
function hash8(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}
/** 移除 tesseract chi_sim 在中文字符间插入的多余空格;保留中英/中标点边界的空格 */
function normalizeOcrText(text: string): string {
  let prev: string;
  do {
    prev = text;
    text = text.replace(
      /([一-鿿㐀-䶿豈-﫿])[^\S\n\r]+([一-鿿㐀-䶿豈-﫿])/g,
      "$1$2",
    );
  } while (text !== prev);
  return text;
}
function sanitize(name: string): string {
  const base = basename(name).replace(/\.[^.]+$/, "");
  // eslint-disable-next-line no-control-regex -- 需要清理文件名里的控制字符
  return base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 40) || "image";
}
function sessionIdOf(ctx: any): string {
  try {
    const sm = ctx?.sessionManager;
    if (sm && typeof sm.getSessionId === "function") {
      const id = sm.getSessionId();
      if (typeof id === "string" && id) return id;
    }
    if (sm && typeof sm.getSessionFile === "function") {
      const f = sm.getSessionFile();
      if (f) return hash8(String(f));
    }
  } catch {
    /* ignore */
  }
  return hash8(String(ctx?.cwd ?? "default"));
}
function truncate(text: string) {
  const lines = text.split("\n");
  let kept = lines.slice(0, MAX_LINES).join("\n");
  let truncated = lines.length > MAX_LINES;
  if (Buffer.byteLength(kept, "utf8") > MAX_BYTES) {
    kept = Buffer.from(kept, "utf8").subarray(0, MAX_BYTES).toString("utf8");
    truncated = true;
  }
  return { content: kept, truncated, totalLines: lines.length };
}

/** RapidOCR 引擎:spawn Python 脚本识别(需本地 python + rapidocr-onnxruntime) */
function runRapidocr(imgPath: string, pythonPath: string | undefined, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = join(home(), ".pi", "agent", "extensions", "ocr", "_rapidocr.py");
    const proc = spawn(pythonPath || "python", [script, imgPath], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    proc.on("error", (e) => reject(new Error(`RapidOCR 启动失败(未安装 Python?): ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`RapidOCR 失败(退出码 ${code}): ${stderr.trim() || "未知错误"}`));
    });
    signal?.addEventListener("abort", () => proc.kill());
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ocr",
    label: "OCR",
    description:
      "对图片文件做文字识别(OCR)。默认 tesseract 引擎(chi_sim+eng);可设 engine='rapidocr' 用 PaddleOCR 模型(中文更强,需本地 Python+rapidocr-onnxruntime)。适用于截图、照片、read_pdf 导出的扫描页。路径可带前导 @。",
    promptSnippet: "识别图片中的文字(默认中英文)",
    promptGuidelines: [
      "当 read_pdf 导出了扫描/图片页的图片路径时,用 ocr 工具识别其中的文字。",
      "ocr 也适用于任意图片(截图/照片)。复杂版式或手写若识别效果不佳,可建议用户启用视觉模型(view_image)。",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "图片文件路径,相对 cwd 或绝对路径,可带前导 @" }),
      lang: Type.Optional(
        Type.String({ description: "识别语言(tesseract 引擎),默认 chi_sim+eng。多语言用 + 连接" }),
      ),
      engine: Type.Optional(
        Type.Union(
          [Type.Literal("tesseract"), Type.Literal("rapidocr")],
          { description: "OCR 引擎:tesseract(默认,纯 JS)或 rapidocr(PaddleOCR 模型,中文强,需本地 Python+rapidocr-onnxruntime)" },
        ),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = (ctx as any)?.cwd ?? process.cwd();
      let rawPath = String((params as any).path ?? "").trim();
      if (rawPath.startsWith("@")) rawPath = rawPath.slice(1);
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      const lang = (params as any).lang ? String((params as any).lang) : TESS_LANG_DEFAULT;
      const engine = (params as any).engine === "rapidocr" ? "rapidocr" : "tesseract";

      if (!existsSync(absPath)) throw new Error(`图片不存在: ${absPath}`);
      const ext = extname(absPath).toLowerCase();
      if (!IMAGE_EXT.has(ext)) {
        throw new Error(`不支持的图片格式: ${ext}(支持 ${[...IMAGE_EXT].join(", ")})`);
      }

      let text = "";
      let confidence: number | undefined;
      if (engine === "rapidocr") {
        if (signal?.aborted) throw new Error("已取消");
        text = await runRapidocr(absPath, (params as any).pythonPath, signal);
      } else {
        await mkdir(tessDir(), { recursive: true });
        let worker: any;
        try {
          worker = await Tesseract.createWorker(lang, 1, {
            cachePath: tessDir(),
            logger: (m: { status?: string; progress?: number }) => {
              if (m?.status && typeof m.progress === "number") {
                onUpdate?.({
                  content: [{ type: "text" as const, text: `OCR: ${m.status} ${Math.round(m.progress * 100)}%` }],
                });
              }
            },
          });
          if (signal?.aborted) throw new Error("已取消");
          const { data } = await worker.recognize(absPath);
          await worker.terminate();
          worker = null;
          text = normalizeOcrText((data?.text ?? "").trim());
          confidence = data?.confidence;
        } catch (e) {
          if (worker) {
            try { await worker.terminate(); } catch { /* ignore */ }
          }
          const msg = (e as Error).message ?? String(e);
          if (/lang|tessdata|download|404|fetch|ECONN|ETIMEDOUT/i.test(msg)) {
            throw new Error(`OCR 初始化失败(可能是语言数据下载失败):${msg}\n语言数据缓存于 ${tessDir()}。`);
          }
          throw e;
        }
      }

      const sid = sessionIdOf(ctx);
      const dir = join(artifactsRoot(), sid, "ocr", `${sanitize(absPath)}-${hash8(absPath)}`);
      await mkdir(dir, { recursive: true });
      const meta = { source: absPath, engine, lang, confidence, extractedAt: new Date().toISOString() };
      await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

      let body = text || "(未识别到文字。可能是扫描质量差或不含文字;可换引擎或尝试 view_image 启用视觉模型。)";
      const tr = truncate(body);
      if (tr.truncated) {
        await writeFile(join(dir, "result.txt"), body, "utf8");
        body = tr.content + `\n\n[已截断。完整结果已存至: ${join(dir, "result.txt")}]`;
      }
      return {
        content: [{ type: "text", text: body }],
        details: { engine, lang, confidence, truncated: tr.truncated },
      };
    },
  });

  pi.registerTool({
    name: "view_image",
    label: "View Image",
    description:
      "视觉模型升级:把图片作为消息注入对话,让多模态 LLM 直接查看(消耗较多 token,仅在 OCR 不足时使用)。仅当当前模型支持图片输入时生效。路径可带前导 @。",
    promptSnippet: "把图片交给多模态模型直接看(opt-in,费 token)",
    promptGuidelines: [
      "view_image 会消耗较多 token,仅在 ocr 无法胜任(复杂版式/图表/手写)时,经用户同意后使用。",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "图片文件路径,可带前导 @" }),
      note: Type.Optional(Type.String({ description: "可选:附带的说明文字" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = (ctx as any)?.cwd ?? process.cwd();
      let rawPath = String((params as any).path ?? "").trim();
      if (rawPath.startsWith("@")) rawPath = rawPath.slice(1);
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      if (!existsSync(absPath)) throw new Error(`图片不存在: ${absPath}`);
      const ext = extname(absPath).toLowerCase();
      const mediaType = MIME[ext];
      if (!mediaType) throw new Error(`不支持的图片格式: ${ext}`);

      const model: any = (ctx as any)?.model;
      if (model && Array.isArray(model.input) && !model.input.includes("image")) {
        return {
          content: [
            {
              type: "text",
              text: `当前模型 ${model.id ?? "(未知)"} 不支持图片输入。请在模型管理中切换到支持视觉/多模态的模型后再试。`,
            },
          ],
        };
      }

      const data = (await readFile(absPath)).toString("base64");
      const note = (params as any).note ? String((params as any).note) : "请查看这张图片";
      // 以 followUp 注入:当前工具执行中不触发即时重入,下一轮对模型可见
      pi.sendUserMessage(
        [
          { type: "image", data, mimeType: mediaType },
          { type: "text", text: note },
        ],
        { deliverAs: "followUp" },
      );
      return {
        content: [
          {
            type: "text",
            text: `已将图片 ${basename(absPath)} 加入对话(下一轮对模型可见)。若模型未正确识别,请确认当前为多模态模型。`,
          },
        ],
      };
    },
  });
}
