/**
 * 诊断：用 mermaid 渲染目标笔记的所有图，检查每张 SVG 是否能通过严格 XML 解析
 * （DOMParser image/svg+xml）。不能通过的图会被 post-processor 静默丢弃。
 * 用法：node scripts/xml-check.mjs <笔记路径>
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="c"></div></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.CSSStyleSheet = dom.window.CSSStyleSheet;
for (const name of ["SVGGElement", "SVGTextElement", "SVGGraphicsElement", "SVGElement"]) {
	const C = dom.window[name];
	if (C && !C.prototype.getBBox) C.prototype.getBBox = () => ({ x: 0, y: 0, width: 120, height: 40 });
}

const md = readFileSync(process.argv[2], "utf8");
const blocks = [];
const lines = md.split("\n");
let inBlock = false, start = 0, buf = [];
for (let i = 0; i < lines.length; i++) {
	if (!inBlock && lines[i].trim() === "```mermaid") { inBlock = true; start = i + 1; buf = []; }
	else if (inBlock && lines[i].trim() === "```") { inBlock = false; blocks.push({ line: start + 1, src: buf.join("\n") }); }
	else if (inBlock) buf.push(lines[i]);
}

const mermaid = (await import("mermaid")).default;
mermaid.initialize({
	startOnLoad: false, securityLevel: "strict",
	theme: "base",
	themeVariables: { background: "#ffffff", primaryColor: "#eeeeee", textColor: "#222222" },
});

for (const b of blocks) {
	const head = b.src.trim().split("\n")[0];
	try {
		const { svg } = await mermaid.render(`chk-${b.line}`, b.src);
		const xml = new dom.window.DOMParser().parseFromString(svg, "image/svg+xml");
		const root = xml.documentElement;
		const ok = root?.nodeName === "svg";
		console.log(`${ok ? "XML-OK  " : "XML-FAIL"} line ${b.line} [${head}]${ok ? "" : " → enhance 会静默丢弃!"}`);
		if (!ok) console.log("   ", (xml.documentElement?.textContent ?? "").slice(0, 120));
	} catch (e) {
		console.log(`RENDER-FAIL line ${b.line} [${head}]`, String(e).split("\n")[0]);
	}
}
