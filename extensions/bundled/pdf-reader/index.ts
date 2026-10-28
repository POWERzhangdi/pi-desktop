/**
 * pi 扩展:PDF 阅读器。
 *
 * 注册 read_pdf 工具:
 *  - 用 unpdf 提取 PDF 文本层(按页,支持 pages 范围)
 *  - 对“几乎无文本”的页(疑似扫描/图片页)用 unpdf.extractImages 抽取内嵌图片,
 *    编码为 PNG 落盘,供 ocr 工具识别(组合拳:read_pdf 出文本+图片,ocr 识图)
 *  - 超长文本截断(50KB / 2000 行),全文写入固定产物目录
 *  - 拦截内置 read 工具对 .pdf 的误用,引导改用 read_pdf
 *
 * 产物目录(固定、按会话隔离、按源文件归类):
 *   ~/.pi/agent/artifacts/<sessionId>/pdf/<源文件名>-<hash8>/
 *     fulltext.txt / meta.json / images/p<N>-<i>.png
 * 环境变量 PI_ARTIFACTS_DIR 可覆盖根目录。
 *
 * 依赖:unpdf(文本+图片抽取)、pngjs(像素->PNG)。
 * typebox / @earendil-works/pi-coding-agent 由 pi 运行时提供。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { extractText, extractImages, getDocumentProxy } from "unpdf";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

const MAX_BYTES = 50_000;
const MAX_LINES = 2000;
const LOW_TEXT_THRESHOLD = 50; // 页非空白字符数低于此值视为疑似扫描/图片页
const MIN_IMAGE_DIM = 32; // 小于此尺寸的图片(图标/噪声)跳过
const MAX_IMAGES = 30; // 单次最多导出图片数

function home(): string {
  return process.env.USERPROFILE || process.env.HOME || homedir();
}
function artifactsRoot(): string {
  return process.env.PI_ARTIFACTS_DIR || join(home(), ".pi", "agent", "artifacts");
}
function hash8(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}
function sanitize(name: string): string {
  const base = basename(name).replace(/\.[^.]+$/, "");
  // eslint-disable-next-line no-control-regex -- 需要清理文件名里的控制字符
  return base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 40) || "pdf";
}
/** 会话 id:优先 getSessionId(),回退到 session 文件名 hash */
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

/** raw 像素(1/3/4 通道)-> RGBA PNG Buffer */
function encodePng(data: Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4): Buffer {
  const png = new PNG({ width, height });
  const out = png.data as Buffer;
  if (channels === 4) {
    out.set(data);
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      out[j] = out[j + 1] = out[j + 2] = data[i];
      out[j + 3] = 255;
    }
  }
  return PNG.sync.write(png) as Buffer;
}

/** "1-3,5" -> [1,2,3,5];非法返回 null(=全部) */
function parsePages(spec: string, total: number): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = +m[1];
      let b = +m[2];
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) if (p >= 1 && p <= total) out.add(p);
    } else {
      const n = parseInt(part.trim(), 10);
      if (!Number.isNaN(n) && n >= 1 && n <= total) out.add(n);
      else return null;
    }
  }
  return out.size ? [...out].sort((a, b) => a - b) : null;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_pdf",
    label: "Read PDF",
    description:
      "读取 PDF 文件并提取文本(按页)。对几乎无文本的页(疑似扫描/图片页)会导出内嵌图片为 PNG,可用 ocr 工具继续识别。大文件用 pages 指定页码范围(如 '1-5' 或 '1,3,5')。路径可带前导 @。",
    promptSnippet: "读取 PDF 提取文本;扫描页图片导出后可调 ocr",
    promptGuidelines: [
      "需要读取 .pdf 文件时用 read_pdf,不要用 read(那会得到二进制乱码)。",
      "read_pdf 结果里若含图片路径,说明该页是扫描/图片页,可继续调用 ocr 工具识别图片中的文字。",
      "大 PDF 先用 pages 读前几页,按需翻页,避免一次性提取过多。",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "PDF 文件路径,相对 cwd 或绝对路径,可带前导 @" }),
      pages: Type.Optional(Type.String({ description: "可选页码范围,如 '1-5' 或 '1,3,5'" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = (ctx as any)?.cwd ?? process.cwd();
      let rawPath = String((params as any).path ?? "").trim();
      if (rawPath.startsWith("@")) rawPath = rawPath.slice(1);
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      const pagesSpec = (params as any).pages ? String((params as any).pages) : undefined;

      if (!existsSync(absPath)) throw new Error(`PDF 文件不存在: ${absPath}`);

      const data = new Uint8Array(await readFile(absPath));
      const pdf = await getDocumentProxy(data);
      const { totalPages, text: pageTexts } = await extractText(pdf, { mergePages: false }) as {
        totalPages: number;
        text: string[];
      };

      const wantPages = pagesSpec ? parsePages(pagesSpec, totalPages) : null;
      const pageNumbers = wantPages ?? Array.from({ length: totalPages }, (_, i) => i + 1);

      // 产物目录
      const sid = sessionIdOf(ctx);
      const dir = join(artifactsRoot(), sid, "pdf", `${sanitize(absPath)}-${hash8(absPath)}`);
      await mkdir(join(dir, "images"), { recursive: true });

      const imageList: { page: number; file: string; width: number; height: number }[] = [];
      const parts: string[] = [];
      parts.push(
        `${basename(absPath)}: 共 ${totalPages} 页(已读 ${pageNumbers.length}/${totalPages} 页)`,
      );

      let imgCount = 0;
      for (const p of pageNumbers) {
        if (signal?.aborted) throw new Error("已取消");
        const t = pageTexts[p - 1] ?? "";
        parts.push(`\n[第 ${p} 页]`);
        parts.push(t.trim() || "(本页无可提取文本)");

        // 疑似扫描/图片页:抽取内嵌图片
        if (t.replace(/\s/g, "").length < LOW_TEXT_THRESHOLD) {
          try {
            const imgs = await extractImages(pdf, p);
            for (let i = 0; i < imgs.length; i++) {
              if (imgCount >= MAX_IMAGES) {
                parts.push(`(图片已达上限 ${MAX_IMAGES},余下未导出;可用 pages 缩小范围)`);
                break;
              }
              const im = imgs[i];
              if (im.width < MIN_IMAGE_DIM || im.height < MIN_IMAGE_DIM) continue;
              const fpath = join(dir, "images", `p${p}-${i}.png`);
              await writeFile(fpath, encodePng(im.data, im.width, im.height, im.channels));
              imageList.push({ page: p, file: fpath, width: im.width, height: im.height });
              imgCount++;
            }
          } catch (e) {
            parts.push(`(图片抽取失败: ${(e as Error).message})`);
          }
          const pageImages = imageList.filter((x) => x.page === p);
          if (pageImages.length) {
            parts.push(`(本页疑似扫描/图片页,已导出 ${pageImages.length} 张图片,可调 ocr 识别:)`);
            for (const x of pageImages) parts.push(`  ${x.file}`);
          }
        }
      }

      const body = parts.join("\n");
      const tr = truncate(body);
      let fullTextFile: string | undefined;
      let outText = body;
      if (tr.truncated) {
        fullTextFile = join(dir, "fulltext.txt");
        await writeFile(fullTextFile, body, "utf8");
        outText = tr.content + `\n\n[已截断: ${tr.totalLines} 行。全文已存至: ${fullTextFile}]`;
      }

      const meta = {
        source: absPath,
        totalPages,
        pagesRead: pageNumbers,
        extractedAt: new Date().toISOString(),
        images: imageList,
        truncated: tr.truncated,
        fullTextFile,
      };
      await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

      return {
        content: [{ type: "text", text: outText }],
        details: {
          totalPages,
          pagesRead: pageNumbers,
          images: imageList,
          truncated: tr.truncated,
          fullTextFile,
        },
      };
    },
  });

  // 防御:LLM 若误用内置 read 读 .pdf,拦截并引导到 read_pdf
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "read") return;
    const p = (event.input as { path?: string } | undefined)?.path;
    if (p && p.replace(/^@/, "").toLowerCase().endsWith(".pdf")) {
      return { block: true, reason: "PDF 文件请改用 read_pdf 工具读取(read 只会得到二进制乱码)。" };
    }
  });
}
