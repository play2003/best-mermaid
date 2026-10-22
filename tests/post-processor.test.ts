import { describe, it, expect } from "vitest";
import { PostProcessor } from "../src/pipeline/post-processor";

/** 模拟 mermaid htmlLabels 的输出：foreignObject 内含 HTML 风格 <br>（XML 下非法） */
const HTML_STYLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">line1<br>line2</div></foreignObject></svg>`;

describe("PostProcessor SVG 解析", () => {
	it("合法 XML 走严格解析", () => {
		const el = document.createElement("div");
		const pp = new PostProcessor();
		const svg = pp.enhance(el, '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
		expect(svg).toBeTruthy();
		expect(el.querySelector(".best-mermaid-wrap svg")).toBeTruthy();
	});

	it("HTML 风格标记（未闭合 <br>）走兜底解析（回归：部分图无声消失无错误框）", () => {
		const el = document.createElement("div");
		const pp = new PostProcessor();
		const svg = pp.enhance(el, HTML_STYLE_SVG);
		expect(svg).toBeTruthy();
		expect(el.querySelector(".best-mermaid-wrap svg")).toBeTruthy();
	});

	it("彻底非法的输入抛错（由 ErrorBoundary 可见化，不静默）", () => {
		const el = document.createElement("div");
		const pp = new PostProcessor();
		expect(() => pp.enhance(el, "definitely not svg <<<")).toThrow();
	});
});
