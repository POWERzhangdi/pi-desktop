/**
 * pi 扩展:Excel 阅读器。
 *
 * 注册 read_excel 工具:
 *  - 用 exceljs 解析 .xlsx/.csv(及 .xls 尽力),提取单元格值成 Markdown 表格
 *  - 支持 sheet 参数(指定工作表名/序号)、rows 参数(行范围,默认前 100 行)
 *  - 超长截断(50KB / 2000 行),全文写入固定产物目录
 *  - 拦截内置 read 工具对 .xlsx/.xls/.csv 的误用,引导改用 read_excel
 *
 * 产物目录:~/.pi/agent/artifacts/<sessionId>/excel/<源文件名>-<hash8>/{fulltext.txt,meta.json}
 * 环境变量 PI_ARTIFACTS_DIR 可覆盖根目录。
 *
 * 依赖:exceljs。typebox / @earendil-works/pi-coding-agent 由 pi 运行时提供。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve, isAbsolute, join, extname } from "node:path";
import { homedir } from "node:os";

const MAX_BYTES = 50_000;
const MAX_LINES = 2000;
const DEFAULT_ROW_LIMIT = 100;
const EXCEL_EXT = new Set([".xlsx", ".xls", ".csv"]);

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
  return base.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 40) || "excel";
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
/** exceljs 单元格值 -> 文本 */
function cellToText(v: any): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined && v.result !== null) return cellToText(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t?.text ?? "").join("");
    if (typeof v.text === "string") return v.text;
    if (typeof v.error === "string") return `#${v.error}`;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}
/** "1-100" / "50" -> {start,end};非法返回 null(=默认前 100 行) */
function parseRows(spec: string, total: number): { start: number; end: number } | null {
  const m = spec.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    if (a > b) [a, b] = [b, a];
    return { start: Math.max(1, a), end: Math.min(total, b) };
  }
  const n = parseInt(spec.trim(), 10);
  if (!Number.isNaN(n) && n >= 1) return { start: 1, end: Math.min(total, n) };
  return null;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_excel",
    label: "Read Excel",
    description:
      "读取 Excel/CSV 文件并提取为 Markdown 表格(xlsx/csv;.xls 尽力)。可用 sheet 指定工作表(名或序号如 1),rows 指定行范围(如 '1-100' 或 '50',默认前 100 行)。路径可带前导 @。",
    promptSnippet: "读取 Excel/CSV 提取为表格",
    promptGuidelines: [
      "需要读取 .xlsx/.xls/.csv 文件时用 read_excel,不要用 read(那会得到二进制乱码)。",
      "大 Excel 先用 rows 限制行数或 sheet 指定单个工作表,避免一次性提取过多。",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Excel/CSV 文件路径,相对 cwd 或绝对路径,可带前导 @" }),
      sheet: Type.Optional(
        Type.String({ description: "可选:工作表名或序号(如 '1' 或 'Sheet1'),缺省=所有工作表" }),
      ),
      rows: Type.Optional(Type.String({ description: "可选:行范围,如 '1-100' 或 '50'(默认前 100 行)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = (ctx as any)?.cwd ?? process.cwd();
      let rawPath = String((params as any).path ?? "").trim();
      if (rawPath.startsWith("@")) rawPath = rawPath.slice(1);
      const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
      const sheetSpec = (params as any).sheet ? String((params as any).sheet) : undefined;
      const rowsSpec = (params as any).rows ? String((params as any).rows) : undefined;

      if (!existsSync(absPath)) throw new Error(`Excel 文件不存在: ${absPath}`);
      const ext = extname(absPath).toLowerCase();
      if (!EXCEL_EXT.has(ext)) {
        throw new Error(`不支持的格式: ${ext}(支持 ${[...EXCEL_EXT].join(", ")})`);
      }

      const wb = new ExcelJS.Workbook();
      try {
        if (ext === ".csv") {
          await wb.csv.readFile(absPath);
        } else {
          // .xlsx 稳定; .xls(旧二进制) exceljs 支持弱,失败给提示
          await wb.xlsx.readFile(absPath);
        }
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (ext === ".xls") {
          throw new Error(`解析 .xls 失败(exceljs 对旧二进制 .xls 支持有限,建议另存为 .xlsx):${msg}`);
        }
        throw new Error(`解析 Excel 失败: ${msg}`);
      }

      // 选工作表
      let sheets: any[] = [];
      if (sheetSpec) {
        const byNum = /^\d+$/.test(sheetSpec) ? wb.getWorksheet(Number(sheetSpec)) : null;
        const ws = byNum ?? wb.getWorksheet(sheetSpec);
        if (!ws) {
          const names = [...(wb.worksheets as any[])].map((s) => s.name).join(", ");
          throw new Error(`工作表不存在: ${sheetSpec}(可用: ${names})`);
        }
        sheets = [ws];
      } else {
        sheets = [...(wb.worksheets as any[])];
      }

      const sid = sessionIdOf(ctx);
      const dir = join(artifactsRoot(), sid, "excel", `${sanitize(absPath)}-${hash8(absPath)}`);
      await mkdir(dir, { recursive: true });

      const parts: string[] = [`${basename(absPath)}: 共 ${sheets.length} 个工作表`];
      const sheetMeta: { name: string; rows: number; cols: number }[] = [];

      for (const ws of sheets) {
        if (signal?.aborted) throw new Error("已取消");
        const totalRows = ws.actualRowCount || 0;
        const cols = ws.actualColumnCount || 0;
        const range =
          (rowsSpec ? parseRows(rowsSpec, totalRows) : null) ?? {
            start: 1,
            end: Math.min(totalRows, DEFAULT_ROW_LIMIT),
          };
        sheetMeta.push({ name: ws.name, rows: totalRows, cols });

        parts.push(
          `\n## ${ws.name} (${totalRows}行 × ${cols}列${totalRows > range.end ? `,已读 ${range.start}-${range.end}` : ""})`,
        );
        if (totalRows === 0 || cols === 0) {
          parts.push("(空工作表)");
          continue;
        }
        const tableLines: string[] = [];
        for (let r = range.start; r <= range.end; r++) {
          if (signal?.aborted) throw new Error("已取消");
          const row = ws.getRow(r);
          const cells: string[] = [];
          for (let c = 1; c <= cols; c++) {
            const t = cellToText(row.values[c])
              .replace(/\|/g, "\\|")
              .replace(/\r?\n/g, " ");
            cells.push(t);
          }
          tableLines.push(`| ${cells.join(" | ")} |`);
          if (r === range.start) {
            tableLines.push(`|${Array(cols).fill("---").join("|")}|`);
          }
        }
        parts.push(tableLines.join("\n"));
        if (totalRows > range.end) {
          parts.push(
            `\n(仅展示前 ${range.end} 行,共 ${totalRows} 行。可用 rows='1-${Math.min(totalRows, range.end * 2)}' 读更多)`,
          );
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
        format: ext,
        totalSheets: sheets.length,
        sheets: sheetMeta,
        extractedAt: new Date().toISOString(),
        truncated: tr.truncated,
        fullTextFile,
      };
      await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

      return {
        content: [{ type: "text", text: outText }],
        details: {
          totalSheets: sheets.length,
          sheets: sheetMeta,
          truncated: tr.truncated,
          fullTextFile,
        },
      };
    },
  });

  // 防御:LLM 若误用内置 read 读 Excel/CSV,拦截并引导到 read_excel
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "read") return;
    const p = (event.input as { path?: string } | undefined)?.path;
    if (p && EXCEL_EXT.has(extname(p.replace(/^@/, "")).toLowerCase())) {
      return { block: true, reason: "Excel/CSV 文件请改用 read_excel 工具读取(read 只会得到二进制乱码)。" };
    }
  });
}
