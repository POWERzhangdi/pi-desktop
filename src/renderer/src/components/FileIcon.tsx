/**
 * 文件类型图标(苹果 Finder 风)。
 * - 目录:蓝色文件夹图标
 * - 图片:绿色图片图标
 * - 其他:彩色圆角方块 + 类型缩写(TS/JS/Py/J/PDF…),按扩展名映射
 */
const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff"]);

const FILE_TYPES: Record<string, { label: string; cls: string }> = {
	ts: { label: "TS", cls: "bg-accent/15 text-accent" },
	tsx: { label: "TS", cls: "bg-accent/15 text-accent" },
	js: { label: "JS", cls: "bg-yellow/20 text-yellow" },
	jsx: { label: "JS", cls: "bg-yellow/20 text-yellow" },
	mjs: { label: "JS", cls: "bg-yellow/20 text-yellow" },
	cjs: { label: "JS", cls: "bg-yellow/20 text-yellow" },
	py: { label: "Py", cls: "bg-green/15 text-green" },
	java: { label: "J", cls: "bg-orange/15 text-orange" },
	kt: { label: "K", cls: "bg-orange/15 text-orange" },
	json: { label: "{}", cls: "bg-yellow/15 text-yellow" },
	md: { label: "M", cls: "bg-purple/15 text-purple" },
	markdown: { label: "M", cls: "bg-purple/15 text-purple" },
	pdf: { label: "P", cls: "bg-red/15 text-red" },
	xml: { label: "<>", cls: "bg-orange/15 text-orange" },
	html: { label: "<>", cls: "bg-orange/15 text-orange" },
	css: { label: "#", cls: "bg-purple/15 text-purple" },
	scss: { label: "#", cls: "bg-purple/15 text-purple" },
	less: { label: "#", cls: "bg-purple/15 text-purple" },
	yml: { label: "Y", cls: "bg-purple/15 text-purple" },
	yaml: { label: "Y", cls: "bg-purple/15 text-purple" },
	toml: { label: "T", cls: "bg-purple/15 text-purple" },
	ini: { label: "T", cls: "bg-purple/15 text-purple" },
	env: { label: "E", cls: "bg-purple/15 text-purple" },
	sql: { label: "DB", cls: "bg-red/15 text-red" },
	sh: { label: "$", cls: "bg-green/15 text-green" },
	bash: { label: "$", cls: "bg-green/15 text-green" },
	go: { label: "Go", cls: "bg-accent/15 text-accent" },
	rs: { label: "R", cls: "bg-orange/15 text-orange" },
	c: { label: "C", cls: "bg-accent/15 text-accent" },
	h: { label: "H", cls: "bg-accent/15 text-accent" },
	cpp: { label: "C+", cls: "bg-accent/15 text-accent" },
	cc: { label: "C+", cls: "bg-accent/15 text-accent" },
	lock: { label: "🔒", cls: "bg-side text-txt2" },
	log: { label: "L", cls: "bg-side text-txt2" },
	txt: { label: "T", cls: "bg-side text-txt2" },
};

export function FileIcon({ name, isDir, size = 16 }: { name: string; isDir?: boolean; size?: number }) {
	if (isDir) {
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="shrink-0 text-accent"
			>
				<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
			</svg>
		);
	}
	const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
	if (IMG_EXT.has(ext)) {
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="shrink-0 text-green"
			>
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<polyline points="21 15 16 10 5 21" />
			</svg>
		);
	}
	const t = FILE_TYPES[ext] ?? { label: "·", cls: "bg-side text-txt2" };
	return (
		<span
			className={`inline-flex items-center justify-center rounded-[3px] font-bold leading-none ${t.cls}`}
			style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
		>
			{t.label}
		</span>
	);
}
