/**
 * 极简 tar(ustar + GNU longname)读写。
 *
 * 为什么自己写:内置 pi 运行时载荷是一棵 1.9 万文件的 node_modules 树,
 * 直接作为 extraResources 目录会被 electron-builder 的 `!node_modules/**`
 * 规则一起过滤掉;打成单个 tar 就绕开了路径匹配问题,而且只随包附带一个文件。
 *
 * 只支持本场景需要的:普通文件/目录/GNU 长文件名;不支持符号链接与硬链接。
 * 不使用压缩(安装包本身有压缩),换取零依赖与可流式校验。
 */
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const BLOCK = 512;
const RECORD = 20 * BLOCK; // tar 以 20 个块(10240 字节)为记录单位

interface Header {
	name: string;
	size: number;
	type: "file" | "dir" | "longname";
}

function toPosix(p: string): string {
	return p.split(sep).join("/");
}

/** 写字符串到定长字段(不足补 0) */
function writeString(buf: Buffer, offset: number, length: number, value: string): void {
	buf.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

/** 八进制数字字段(如 size/mode/mtime),以 NUL 或空格结尾 */
function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
	const text = value.toString(8).padStart(length - 1, "0");
	buf.write(text, offset, length - 1, "ascii");
	buf[offset + length - 1] = 0;
}

/** 拆分 name/prefix,满足 ustar 的 100 + 155 限制;返回 null 表示需要 GNU longname */
function splitName(path: string): { name: string; prefix: string } | null {
	if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
	const parts = path.split("/");
	for (let i = parts.length - 1; i > 0; i--) {
		const prefix = parts.slice(0, i).join("/");
		const name = parts.slice(i).join("/");
		if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
	}
	return null;
}

function headerBlock(h: Header): Buffer {
	const buf = Buffer.alloc(BLOCK, 0);
	const name = h.type === "dir" && !h.name.endsWith("/") ? `${h.name}/` : h.name;
	const isLong = h.type === "longname";
	const split = isLong ? null : splitName(name);
	const size = isLong ? Buffer.byteLength(h.name) + 1 : (h.size ?? 0);

	if (isLong) {
		writeString(buf, 0, 100, "././@LongLink");
	} else if (split) {
		writeString(buf, 0, 100, split.name);
		writeString(buf, 345, 155, split.prefix);
	} else {
		// 若走到这里说明路径超限,截断只用于兜底(正常构建不会发生)
		writeString(buf, 0, 100, name.slice(0, 100));
	}
	writeOctal(buf, 100, 8, isLong ? 0o644 : (h.type === "dir" ? 0o755 : 0o644));
	writeOctal(buf, 108, 8, 0); // uid
	writeOctal(buf, 116, 8, 0); // gid
	writeOctal(buf, 124, 12, size);
	writeOctal(buf, 136, 12, Math.floor(Date.now() / 1000));
	buf[156] = (isLong ? "L" : h.type === "dir" ? "5" : "0").charCodeAt(0);
	writeString(buf, 257, 6, "ustar");
	buf[262] = 0;
	writeString(buf, 263, 2, "00");
	// checksum:先按空格计算,再写入
	buf.fill(0x20, 148, 156);
	let sum = 0;
	for (let i = 0; i < BLOCK; i++) sum += buf[i]!;
	writeOctal(buf, 148, 8, sum);
	return buf;
}

/**
 * 把 rootDir 打包成 tar 文件(含 rootDir 下所有文件与目录)。
 * 长路径自动追加 GNU ././@LongLink 头。
 */
export function writeTarFile(rootDir: string, outPath: string): number {
	const fd = openSync(outPath, "w");
	let count = 0;
	let recordBytes = 0;
	const write = (buf: Buffer) => {
		writeSync(fd, buf);
		recordBytes += buf.length;
	};
	const writeFileData = (abs: string, size: number) => {
		const content = Buffer.alloc(size);
		const inFd = openSync(abs, "r");
		try {
			let read = 0;
			while (read < size) read += readSync(inFd, content, read, size - read, read);
		} finally {
			closeSync(inFd);
		}
		write(content);
		const pad = (BLOCK - (size % BLOCK)) % BLOCK;
		if (pad > 0) write(Buffer.alloc(pad, 0));
	};
	const add = (abs: string, rel: string) => {
		const st = statSync(abs);
		const entry: Header = {
			name: toPosix(rel),
			size: st.size,
			type: st.isDirectory() ? "dir" : "file",
		};
		const split = splitName(entry.type === "dir" ? `${entry.name}/` : entry.name);
		if (!split) {
			// GNU longname:先写路径,再写真实头(真实头里放截断名)
			const longHeader = headerBlock({ name: entry.name, size: 0, type: "longname" });
			write(longHeader);
			const nameBuf = Buffer.from(`${entry.name}\0`, "utf8");
			write(nameBuf);
			const pad = (BLOCK - (nameBuf.length % BLOCK)) % BLOCK;
			if (pad > 0) write(Buffer.alloc(pad, 0));
		}
		write(headerBlock(entry));
		if (entry.type === "file") writeFileData(abs, st.size);
		count++;
	};
	const walk = (dir: string) => {
		for (const item of readdirSync(dir, { withFileTypes: true })) {
			const abs = join(dir, item.name);
			add(abs, relative(rootDir, abs));
			if (item.isDirectory()) walk(abs);
		}
	};

	walk(rootDir);

	// 结尾两个全零块 + 补齐到记录边界
	write(Buffer.alloc(BLOCK * 2, 0));
	const pad = (RECORD - (recordBytes % RECORD)) % RECORD;
	if (pad > 0) write(Buffer.alloc(pad, 0));
	closeSync(fd);
	return count;
}

function parseOctal(buf: Buffer, offset: number, length: number): number {
	const text = buf.toString("ascii", offset, offset + length).replace(/\0| /g, "").trim();
	return text ? Number.parseInt(text, 8) : 0;
}

function parseString(buf: Buffer, offset: number, length: number): string {
	const end = buf.indexOf(0, offset);
	const stop = end === -1 || end > offset + length ? offset + length : end;
	return buf.toString("utf8", offset, stop);
}

/** 从 tar 文件解到 destDir(覆盖同名文件);返回解出的文件数 */
/** 从 tar 文件解到 destDir(覆盖同名文件);返回解出的文件数。
 *  整包读进内存 + 目录去重:1.9 万个小文件时,逐块 readSync 会慢到 8s 级。 */
export function extractTarFile(tarPath: string, destDir: string): number {
	const buf = readFileSync(tarPath);
	let offset = 0;
	let pendingLongName: string | null = null;
	let files = 0;
	const createdDirs = new Set<string>([destDir]);

	const ensureDir = (dir: string): void => {
		if (createdDirs.has(dir)) return;
		mkdirSync(dir, { recursive: true });
		createdDirs.add(dir);
	};
	const isZeroBlock = (block: Buffer): boolean => {
		for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
		return true;
	};

	while (offset + BLOCK <= buf.length) {
		const header = buf.subarray(offset, offset + BLOCK);
		if (isZeroBlock(header)) break; // 全零块 = 归档结束

		const name = parseString(header, 0, 100);
		const prefix = parseString(header, 345, 155);
		const fullName = prefix ? `${prefix}/${name}` : name;
		const entrySize = parseOctal(header, 124, 12);
		const type = String.fromCharCode(header[156]!);
		const dataStart = offset + BLOCK;
		const dataBlocks = Math.ceil(entrySize / BLOCK) * BLOCK;

		if (type === "L") {
			pendingLongName = buf.toString("utf8", dataStart, dataStart + entrySize).replace(/\0+$/, "");
		} else if (type === "5") {
			ensureDir(join(destDir, pendingLongName ?? fullName));
			pendingLongName = null;
		} else if (type === "0" || type === "\0") {
			const target = join(destDir, pendingLongName ?? fullName);
			pendingLongName = null;
			ensureDir(dirname(target));
			writeFileSync(target, buf.subarray(dataStart, dataStart + entrySize));
			files++;
		} else {
			// 符号链接/硬链接等:跳过数据
			pendingLongName = null;
		}
		offset = dataStart + dataBlocks;
	}
	return files;
}
