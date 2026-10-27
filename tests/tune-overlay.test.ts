import { describe, it, expect } from "vitest";
import {
	anchorOnSide,
	applyTuneOverlay,
	decodePoints,
	edgeRefFromId,
	measureNodeBox,
	nodeKey,
	parseTune,
	reanchorEnd,
	serializeTune,
	sideOf,
	validateTune,
} from "../src/pipeline/tune-overlay";
import type { BmTuneData } from "../src/types";

const SVG_NS = "http://www.w3.org/2000/svg";

function encode(points: Array<{ x: number; y: number }>): string {
	return btoa(JSON.stringify(points));
}

function makeSvg(points = [{ x: 85, y: 50 }, { x: 170, y: 50 }]): SVGSVGElement {
	const markup = `<svg xmlns="${SVG_NS}" viewBox="0 0 300 200" width="300" height="200">
		<g class="nodes">
			<g class="node default" id="flowchart-A-0" data-id="A" transform="translate(50, 50)">
				<rect x="-35" y="-18" width="70" height="36"></rect>
				<g class="label"><text><tspan>Start</tspan></text></g>
			</g>
			<g class="node default" id="flowchart-B-1" data-id="B" transform="translate(200, 50)">
				<rect x="-30" y="-18" width="60" height="36"></rect>
			</g>
		</g>
		<g class="edgePaths">
			<path id="L_A_B_0" data-id="L_A_B_0" data-points="${encode(points)}"
				d="M 85,50 L 170,50" marker-end="url(#arrow)"></path>
		</g>
	</svg>`;
	const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
	return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}

describe("bm-tune 数据解析/序列化", () => {
	it("解析合法数据", () => {
		const { tune, error } = parseTune('{"v":1,"nodes":{"A":{"x":1,"y":2,"w":100,"h":40}}}');
		expect(error).toBeNull();
		expect(tune?.nodes?.A).toEqual({ x: 1, y: 2, w: 100, h: 40 });
	});

	it("非法 JSON 返回 syntax", () => {
		expect(parseTune("{oops")).toEqual({ tune: null, error: "syntax" });
	});

	it("更高版本返回 version（不破坏原数据）", () => {
		expect(parseTune('{"v":2,"nodes":{}}')).toEqual({ tune: null, error: "version" });
	});

	it("丢弃非法节点、保留合法节点，尺寸兜底最小值", () => {
		const { tune } = parseTune('{"v":1,"nodes":{"A":{"x":0,"y":0,"w":10,"h":5},"B":{"x":"x"}}}');
		expect(tune?.nodes?.A.w).toBeGreaterThanOrEqual(40);
		expect(tune?.nodes?.B).toBeUndefined();
	});

	it("序列化：key 排序、0.1 精度、% 转义", () => {
		const raw = serializeTune({
			v: 1,
			nodes: { Z: { x: 1.26, y: 2, w: 100, h: 40 }, A: { x: 3, y: 4, w: 100, h: 40 } },
			edges: { "L_A_Z_0": { from: "A", to: "Z", src: "r", dst: "l", pts: [[1.267, 2], [3, 4]] } },
		});
		expect(raw.indexOf('"A"')).toBeLessThan(raw.indexOf('"Z"'));
		expect(raw).toContain("1.3");
		expect(raw).not.toContain("%");
		const parsed = JSON.parse(raw.replace(/\\u0025/g, "%")) as BmTuneData;
		expect(parsed.edges?.L_A_Z_0.pts?.[0][0]).toBe(1.3);
	});
});

describe("节点/边标识", () => {
	it("nodeKey 优先 data-id，回退 flowchart-<id>-<n>", () => {
		const svg = makeSvg();
		const group = svg.querySelector("g.node")!;
		expect(nodeKey(group)).toBe("A");
		group.removeAttribute("data-id");
		expect(nodeKey(group)).toBe("A");
	});

	it("edgeRefFromId 解析默认边 id", () => {
		expect(edgeRefFromId("L_A_B_0")).toEqual({ from: "A", to: "B" });
		expect(edgeRefFromId("custom-edge")).toBeNull();
	});
});

describe("几何：覆盖应用", () => {
	it("节点缩放：组中心与 rect 尺寸同步", () => {
		const svg = makeSvg();
		applyTuneOverlay(svg, { v: 1, nodes: { A: { x: 60, y: 55, w: 120, h: 60 } } });
		const group = svg.querySelector('g.node[data-id="A"]')!;
		expect(group.getAttribute("transform")).toBe("translate(60, 55)");
		const rect = group.querySelector("rect")!;
		expect(rect.getAttribute("width")).toBe("120");
		expect(rect.getAttribute("height")).toBe("60");
		expect(rect.getAttribute("x")).toBe("-60");
		expect(rect.getAttribute("y")).toBe("-30");
		expect(measureNodeBox(group)).toEqual({ cx: 60, cy: 55, w: 120, h: 60 });
	});

	it("节点缩放后相连边的端点跟随到新边界", () => {
		const svg = makeSvg();
		applyTuneOverlay(svg, { v: 1, nodes: { A: { x: 50, y: 50, w: 120, h: 60 } } });
		const path = svg.querySelector("path")!;
		const pts = decodePoints(path)!;
		expect(pts[0].x).toBe(110); // A 右边界 = 50 + 60
		expect(pts[pts.length - 1].x).toBe(170);
		expect(path.getAttribute("marker-end")).toBe("url(#arrow)");
	});

	it("幂等：同一份数据重复应用不叠加", () => {
		const svg = makeSvg();
		const tune: BmTuneData = { v: 1, nodes: { A: { x: 50, y: 50, w: 120, h: 60 } } };
		expect(applyTuneOverlay(svg, tune).nodes).toBe(1);
		expect(applyTuneOverlay(svg, tune).nodes).toBe(0);
		const rect = svg.querySelector("rect")!;
		expect(rect.getAttribute("width")).toBe("120");
	});

	it("未知 key 只告警不修改", () => {
		const svg = makeSvg();
		const result = applyTuneOverlay(svg, { v: 1, nodes: { NOPE: { x: 0, y: 0, w: 50, h: 50 } } });
		expect(result.nodes).toBe(0);
		expect(result.warnings.join(" ")).toContain("NOPE");
	});

	it("锚定边：src/dst 指定侧后端点落在对应边", () => {
		const svg = makeSvg();
		applyTuneOverlay(svg, {
			v: 1,
			edges: { L_A_B_0: { from: "A", to: "B", src: "t", dst: "b" } },
		});
		const pts = decodePoints(svg.querySelector("path")!)!;
		expect(pts[0].y).toBe(32); // A 顶边 = 50 - 18
		expect(pts[pts.length - 1].y).toBe(68); // B 底边 = 50 + 18
	});
});

describe("几何工具", () => {
	const box = { cx: 0, cy: 0, w: 100, h: 50 };

	it("sideOf 四向判定", () => {
		expect(sideOf(box, { x: 200, y: 0 })).toBe("r");
		expect(sideOf(box, { x: -200, y: 0 })).toBe("l");
		expect(sideOf(box, { x: 0, y: -200 })).toBe("t");
		expect(sideOf(box, { x: 0, y: 200 })).toBe("b");
	});

	it("anchorOnSide 沿边内缩", () => {
		expect(anchorOnSide(box, "r", { x: 0, y: 0 })).toEqual({ x: 50, y: 0 });
		expect(anchorOnSide(box, "l", { x: 0, y: 999 })).toEqual({ x: -50, y: 21 });
	});

	it("reanchorEnd 保持正交走向（3 点折线）", () => {
		const pts = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 90, y: 20 }];
		reanchorEnd(pts, 0, box, "r");
		expect(pts[0]).toEqual({ x: 50, y: 20 });
		expect(pts[1].y).toBe(20);
	});
});
