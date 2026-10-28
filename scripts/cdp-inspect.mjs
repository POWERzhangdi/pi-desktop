/**
 * 调试用:通过 CDP 连接运行中的 Electron,打开模型与密钥页,
 * 输出窗口/页面/各区域的布局尺寸与越界元素。
 * 用法:node scripts/cdp-inspect.mjs [--open]
 */
const OPEN = process.argv.includes("--open");

const list = await fetch("http://127.0.0.1:9222/json").then((r) => r.json());
const page = list.find((t) => t.type === "page");
if (!page) {
	console.error("未找到页面 target");
	process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	ws.onopen = res;
	ws.onerror = rej;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)(m);
		pending.delete(m.id);
	}
};
function send(method, params = {}) {
	return new Promise((res) => {
		const i = ++seq;
		pending.set(i, res);
		ws.send(JSON.stringify({ id: i, method, params }));
	});
}
async function evalJs(expression) {
	const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (r.result?.exceptionDetails) {
		throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
	}
	return r.result?.result?.value;
}

if (OPEN) {
	// 点状态栏第一个按钮(模型选择器) → 点「管理模型」
	const opened = await evalJs(`(async () => {
		const trigger = document.querySelector("div.h-11 button");
		if (!trigger) return "no statusbar button";
		trigger.click();
		await new Promise((r) => setTimeout(r, 250));
		const manage = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "管理模型");
		if (!manage) return "no manage button";
		manage.click();
		await new Promise((r) => setTimeout(r, 400));
		return "opened";
	})()`);
	console.log("open:", opened);
}

const report = await evalJs(`(() => {
	const winW = window.innerWidth, winH = window.innerHeight;
	const doc = document.documentElement;
	const out = {
		win: [winW, winH],
		docScroll: [doc.scrollWidth, doc.scrollHeight],
		docClient: [doc.clientWidth, doc.clientHeight],
	};
	const root = document.querySelector(".animate-page, .page-exit");
	if (root) {
		const r = root.getBoundingClientRect();
		out.pageRect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
	}
	// 各区域
	const regions = {};
	for (const [name, sel] of Object.entries({
		header: "header",
		aside: "aside",
		asideList: "aside > div:last-child",
		section: "section",
		detailCard: "section .max-w-3xl > div",
	})) {
		const el = document.querySelector(sel);
		if (!el) continue;
		regions[name] = {
			rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
			client: [el.clientWidth, el.clientHeight],
			scroll: [el.scrollWidth, el.scrollHeight],
			overflowY: el.scrollHeight > el.clientHeight + 1,
		};
	}
	out.regions = regions;
	// 越界元素(超出视口且可见)
	const offenders = [];
	for (const el of document.querySelectorAll("body *")) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		const style = getComputedStyle(el);
		if (style.position === "fixed") continue;
		if (r.bottom > winH + 2 || r.right > winW + 2) {
			const cls = typeof el.className === "string" ? el.className.slice(0, 90) : el.tagName;
			offenders.push({
				tag: el.tagName,
				cls,
				rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
			});
		}
	}
	out.offenders = offenders.slice(0, 12);
	out.offenderCount = offenders.length;
	return out;
})()`);

console.log(JSON.stringify(report, null, 2));
ws.close();
