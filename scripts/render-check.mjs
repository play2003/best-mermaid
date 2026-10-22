/**
 * 无头诊断（渲染级）：在 jsdom 中用插件实际配置逐图完整渲染（带超时），
 * 验证是否存在 mermaid.render 永不返回（挂起）或运行时异常。
 * 用法：node scripts/render-check.mjs <笔记路径>
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="c"></div></body></html>', {
	pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.SVGElement = dom.window.SVGElement;
global.CSSStyleSheet = dom.window.CSSStyleSheet;

// jsdom 缺失的布局 API：mermaid 渲染依赖 getBBox 测量文字
for (const ctor of ["SVGGElement", "SVGTextElement", "SVGGraphicsElement", "SVGElement"]) {
	const C = dom.window[ctor];
	if (C && !C.prototype.getBBox) {
		C.prototype.getBBox = function () {
			return { x: 0, y: 0, width: 120, height: 40 };
		};
		C.prototype.getBBox.toString = () => "function getBBox() { [native code] }";
	}
}

const file = process.argv[2];
const md = readFileSync(file, "utf8");
const blocks = [];
const lines = md.split("\n");
let inBlock = false;
let start = 0;
let buf = [];
for (let i = 0; i < lines.length; i++) {
	if (!inBlock && lines[i].trim() === "```mermaid") {
		inBlock = true;
		start = i + 1;
		buf = [];
	} else if (inBlock && lines[i].trim() === "```") {
		inBlock = false;
		blocks.push({ line: start + 1, src: buf.join("\n") });
	} else if (inBlock) {
		buf.push(lines[i]);
	}
}

const mermaid = (await import("mermaid")).default;
mermaid.initialize({
	startOnLoad: false,
	securityLevel: "strict",
	flowchart: { curve: "linear", rankSpacing: 70, nodeSpacing: 55, padding: 12 },
	theme: "base",
	themeVariables: {
		background: "#0f172a",
		primaryColor: "#1e293b",
		primaryTextColor: "#e2e8f0",
		primaryBorderColor: "#818cf8",
		textColor: "#cbd5e1",
		secondaryTextColor: "#94a3b8",
		lineColor: "#475569",
		arrowheadColor: "#818cf8",
		fontSize: "15px",
		fontFamily: "PingFang SC, sans-serif",
	},
	themeCSS: "\n.node rect { rx: 6; }\n.edgeLabel { background-color: transparent; }\n",
});

let hang = 0;
let failed = 0;
for (const b of blocks) {
	const head = b.src.trim().split("\n")[0];
	const id = `diag-${b.line}`;
	const t0 = Date.now();
	try {
		const res = await Promise.race([
			mermaid.render(id, b.src),
			new Promise((_, rej) => setTimeout(() => rej(new Error("HANG: render 未在 8s 内返回")), 8000)),
		]);
		console.log(`OK    line ${b.line}  [${head}]  svg=${res.svg.length}B  ${Date.now() - t0}ms`);
	} catch (e) {
		const msg = String(e);
		if (msg.includes("HANG")) hang++;
		else failed++;
		console.log(`${msg.includes("HANG") ? "HANG " : "FAIL "} line ${b.line}  [${head}]`);
		console.log(`     ${msg.split("\n").slice(0, 3).join("\n     ")}`);
	} finally {
		document.getElementById(id)?.remove();
	}
}
console.log(`--- hang=${hang} fail=${failed}`);
process.exit(0);
