/**
 * 无头诊断：用工程内同版本 mermaid + 插件的实际配置（strict/base/themeCSS/diagramConfig）
 * 逐块 parse 目标笔记的 mermaid 源码，验证语法与配置兼容性。
 * 用法：node scripts/parse-check.mjs <笔记路径>
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

const file = process.argv[2];
if (!file) {
	console.error("usage: node scripts/parse-check.mjs <note.md>");
	process.exit(1);
}

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

console.log(`found ${blocks.length} mermaid blocks`);

// 模拟 follow 样式卡的最终配置（探针变量用占位色，不影响语法解析）
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

let failed = 0;
for (const b of blocks) {
	const head = b.src.trim().split("\n")[0];
	try {
		await Promise.race([
			mermaid.parse(b.src),
			new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT (5000ms)")), 5000)),
		]);
		console.log(`OK   line ${b.line}  [${head}]`);
	} catch (e) {
		failed++;
		console.log(`FAIL line ${b.line}  [${head}]`);
		console.log(`     ${String(e).split("\n").slice(0, 3).join("\n     ")}`);
	}
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 2);
