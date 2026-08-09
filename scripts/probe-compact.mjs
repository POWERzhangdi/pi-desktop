import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(
	homedir(),
	"AppData",
	"Roaming",
	"npm",
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
);
const hits = [];
function walk(d) {
	for (const e of readdirSync(d, { withFileTypes: true })) {
		const p = join(d, e.name);
		if (e.isDirectory()) walk(p);
		else if (e.name.endsWith(".js")) {
			const c = readFileSync(p, "utf8");
			let i = 0;
			while ((i = c.indexOf("compact", i)) >= 0) {
				const ctx = c.slice(Math.max(0, i - 80), Math.min(c.length, i + 80)).replace(/\s+/g, " ");
				if (/compact/.test(ctx)) hits.push([p, ctx]);
				i += 7;
			}
		}
	}
}
walk(root);
console.log("hits:", hits.length);
for (const [p, ctx] of hits) console.log(p.replace(root, ""), "::", ctx);
