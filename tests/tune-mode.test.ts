import { describe, it, expect, vi, afterEach } from "vitest";
import { TuneModeService } from "../src/services/tune-mode";
import type { TuneModeDeps } from "../src/services/tune-mode";
import { sleep, waitFor } from "./pipeline.test-utils";
import { decodePoints } from "../src/pipeline/tune-overlay";

const SVG_NS = "http://www.w3.org/2000/svg";
const GRAPH = "flowchart LR\n    A[Start] --> B[End]";

function makeSvg(): SVGSVGElement {
	const markup = `<svg xmlns="${SVG_NS}" viewBox="0 0 300 200" width="300" height="200">
		<g class="nodes">
			<g class="node default" id="flowchart-A-0" data-id="A" transform="translate(50, 50)">
				<rect x="-35" y="-18" width="70" height="36"></rect>
				<g class="label"><text>Start</text></g>
			</g>
			<g class="node default" id="flowchart-B-1" data-id="B" transform="translate(200, 50)">
				<rect x="-30" y="-18" width="60" height="36"></rect>
			</g>
		</g>
		<g class="edgePaths"><path id="L_A_B_0" data-id="L_A_B_0" d="M 85,50 L 170,50"></path></g>
	</svg>`;
	const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
	return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}

const harnesses: TuneModeService[] = [];

function makeHarness(source = GRAPH) {
	const el = document.createElement("div");
	el.className = "best-mermaid-container";
	el.dataset.bmSource = source;
	el.dataset.bmSourcePath = "note.md";
	const svg = makeSvg();
	el.appendChild(svg);
	document.body.appendChild(el);

	const rect = { left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0 } as DOMRect;
	el.getBoundingClientRect = () => rect;
	svg.getBoundingClientRect = () => rect;

	const interaction = {
		suspend: vi.fn(),
		resume: vi.fn(),
		reset: vi.fn(),
		isSuspended: () => false,
	};
	const persistence = { save: vi.fn(async () => {}) };
	const refresh = vi.fn();
	const notify = vi.fn();
	const deps: TuneModeDeps = {
		isEnabled: () => true,
		interaction: interaction as never,
		persistence: persistence as never,
		getRawSource: (node) => node.dataset.bmSource,
		getCtx: () => null,
		refresh,
		notify,
	};
	const tune = new TuneModeService(deps);
	harnesses.push(tune);
	tune.attach(el, svg, { tune: null, tuneError: null, rawSource: source, ctx: null });
	return { el, svg, tune, interaction, persistence, refresh, notify };
}

afterEach(() => {
	for (const tune of harnesses.splice(0)) tune.dispose();
	document.body.innerHTML = "";
});

const press = (el: HTMLElement, key: string, target: EventTarget = el) =>
	target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("V 键微调：进入与守卫", () => {
	it("flowchart 图注入铅笔入口并聚焦，非流程图不注入", () => {
		const { el } = makeHarness();
		expect(el.querySelector(".best-mermaid-tune-btn")).toBeTruthy();
		expect(el.tabIndex).toBe(0);

		const other = makeHarness("sequenceDiagram\n A->>B: hi");
		expect(other.el.querySelector(".best-mermaid-tune-btn")).toBeNull();
		expect(other.el.hasAttribute("tabindex")).toBe(false);
	});

	it("聚焦后按 V 进入编辑：HUD/覆盖层出现，缩放被暂停并复位", () => {
		const { el, interaction } = makeHarness();
		press(el, "v");
		expect(el.classList.contains("bm-tuning")).toBe(true);
		expect(el.querySelector(".best-mermaid-tune-hud")).toBeTruthy();
		expect(el.querySelector(".best-mermaid-tune-layer")).toBeTruthy();
		expect(interaction.suspend).toHaveBeenCalledWith(el);
		expect(interaction.reset).toHaveBeenCalled();
	});

	it("输入框内按 V 不触发编辑", () => {
		const { el } = makeHarness();
		const input = document.createElement("input");
		el.appendChild(input);
		press(el, "v", input);
		expect(el.classList.contains("bm-tuning")).toBe(false);
	});

	it("带 Ctrl/Alt/Meta 的 V 不触发", () => {
		const { el } = makeHarness();
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
		expect(el.classList.contains("bm-tuning")).toBe(false);
	});

	it("Escape 取消并恢复交互", () => {
		const { el, interaction, refresh } = makeHarness();
		press(el, "v");
		press(el, "Escape");
		expect(el.classList.contains("bm-tuning")).toBe(false);
		expect(el.querySelector(".best-mermaid-tune-hud")).toBeNull();
		expect(interaction.resume).toHaveBeenCalledWith(el);
		expect(refresh).toHaveBeenCalledWith(el, GRAPH);
	});
});

describe("V 键微调：文字编辑与保存", () => {
	it("双击节点打开内联编辑器，Enter 提交后保存改写源码标签", async () => {
		const { el, svg, persistence, refresh, tune } = makeHarness();
		press(el, "v");

		const node = svg.querySelector('g.node[data-id="A"]')!;
		node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

		const editor = el.querySelector("textarea.bm-tune-inline-editor") as HTMLTextAreaElement;
		expect(editor).toBeTruthy();
		expect(editor.value).toBe("Start");

		editor.value = "新的开始";
		editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		const save = el.querySelector('.best-mermaid-tune-hud button[aria-label="Save"]') as HTMLButtonElement;
		save.click();

		await waitFor(() => persistence.save.mock.calls.length > 0);
		const next = (persistence.save.mock.calls[0] as unknown[])[1] as string;
		expect(next).toContain('A["新的开始"]');
		expect(refresh).toHaveBeenCalled();
		expect(tune.isEditing(el)).toBe(false);
	});

	it("save 失败时保持编辑状态并给出可见提示", async () => {
		const { el, persistence, notify, tune } = makeHarness();
		persistence.save.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "block-not-found" }));
		press(el, "v");
		const save = el.querySelector('.best-mermaid-tune-hud button[aria-label="Save"]') as HTMLButtonElement;
		save.click();
		await waitFor(() => notify.mock.calls.length > 0);
		expect(tune.isEditing(el)).toBe(true);
		expect(String(notify.mock.calls[0][0])).toContain("mermaid");
	});

	it("保存失败前校验：版本过新时拒绝覆盖", async () => {
		const { el, persistence, tune } = makeHarness();
		const staleSource = '%% bm-tune: {"v":2,"nodes":{}} %%\n' + GRAPH;
		tune.detach(el);
		tune.attach(el, el.querySelector("svg") as SVGSVGElement, {
			tune: null,
			tuneError: "version",
			rawSource: staleSource,
			ctx: null,
		});
		press(el, "v");
		const save = el.querySelector('.best-mermaid-tune-hud button[aria-label="Save"]') as HTMLButtonElement;
		save.click();
		await sleep(20);
		expect(persistence.save).not.toHaveBeenCalled();
		expect(tune.isEditing(el)).toBe(true);
	});
});

describe("V 键微调：生命周期", () => {
	it("dispose 清理入口与 HUD", () => {
		const { el, tune } = makeHarness();
		press(el, "v");
		tune.dispose();
		expect(el.querySelector(".best-mermaid-tune-hud")).toBeNull();
		expect(el.querySelector(".best-mermaid-tune-btn")).toBeNull();
		expect(el.classList.contains("bm-tuning")).toBe(false);
	});
});

describe("V 键微调：连线选中的命中容差", () => {
	const down = (target: Element, x: number, y: number) =>
		target.dispatchEvent(
			new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }),
		);

	it("点在细线附近（8px 内）也能选中连线", () => {
		const { el, svg } = makeHarness();
		press(el, "v");
		down(svg, 120, 55); // 线在 y=50，偏 5px
		const overlay = el.querySelector(".best-mermaid-tune-layer")!;
		expect(overlay.querySelector(".bm-tune-edge-hl")).toBeTruthy();
		expect(overlay.querySelectorAll(".bm-tune-handle").length).toBeGreaterThanOrEqual(2);
	});

	it("点击边标签选中连线（标签遮挡线段的场景）", () => {
		const { el, svg } = makeHarness();
		press(el, "v");
		const label = document.createElementNS(SVG_NS, "g");
		label.setAttribute("class", "edgeLabel");
		const inner = document.createElementNS(SVG_NS, "g");
		inner.setAttribute("class", "label");
		inner.setAttribute("data-id", "L_A_B_0");
		label.appendChild(inner);
		svg.appendChild(label);

		down(inner, 130, 50);
		const overlay = el.querySelector(".best-mermaid-tune-layer")!;
		expect(overlay.querySelector(".bm-tune-edge-hl")).toBeTruthy();
	});

	it("点在空白处清空选择", () => {
		const { el, svg } = makeHarness();
		press(el, "v");
		const node = svg.querySelector('g.node[data-id="A"]')!;
		down(node, 50, 50);
		expect(el.querySelector(".bm-tune-outline")).toBeTruthy();
		down(svg, 280, 180);
		expect(el.querySelector(".bm-tune-outline")).toBeNull();
	});
});

describe("V 键微调：连线拖动的吸附与节点连接", () => {
	const down = (target: Element, x: number, y: number) =>
		target.dispatchEvent(
			new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }),
		);
	const move = (x: number, y: number) =>
		window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, bubbles: true }));
	const up = () => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
	const points = (svg: SVGSVGElement) => decodePoints(svg.querySelector("path[data-id]")!)!;

	it("端点拖动接近水平时吸附（锚点沿节点边滑动）", () => {
		const { el, svg } = makeHarness();
		press(el, "v");
		down(svg, 120, 50); // 选中连线
		const overlay = el.querySelector(".best-mermaid-tune-layer")!;
		const startHandle = overlay.querySelectorAll("circle.bm-tune-handle")[0];
		expect(startHandle).toBeTruthy();

		down(startHandle, 85, 50);
		move(90, 57); // 目标锚点 y=57，与另一端 y=50 相差 7（约 4.7°）→ 应吸附到水平
		up();

		const pts = points(svg);
		expect(pts[0].x).toBe(85);
		expect(pts[0].y).toBe(50);
	});

	it("角度超过阈值时不吸附", () => {
		const { el, svg } = makeHarness();
		press(el, "v");
		down(svg, 120, 50);
		const overlay = el.querySelector(".best-mermaid-tune-layer")!;
		const startHandle = overlay.querySelectorAll("circle.bm-tune-handle")[0];

		down(startHandle, 85, 50);
		move(90, 64); // 差值 14，约 9.3° → 不吸附
		up();

		expect(points(svg)[0].y).toBe(64);
	});

	it("拖动带端点的首段时端点保持贴在节点边（不脱离）", () => {
		const { el, svg } = makeHarness();
		const path = svg.querySelector("path[data-id]")!;
		path.setAttribute("data-id", "L_B_A_0");
		path.setAttribute("d", "M 170,50 L 150,50 L 150,120");

		press(el, "v");
		down(path, 160, 50); // 选中并抓住首段（B 的左边界 → 中间折点）
		move(160, 40); // 向上平移 10
		up();

		const pts = points(svg);
		expect(pts[0].x).toBe(170); // 仍贴在 B 的左边界
		expect(pts[0].y).toBe(40);
		expect(pts[1].y).toBe(40); // 首段保持水平
	});
});

describe("V 键微调：直线端点拖动的折线/遮挡问题", () => {
	const down = (target: Element, x: number, y: number) =>
		target.dispatchEvent(
			new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }),
		);
	const move = (x: number, y: number) =>
		window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1, bubbles: true }));
	const up = () => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
	const points = (svg: SVGSVGElement) => decodePoints(svg.querySelector("path[data-id]")!)!;

	function setStraightWithRedundantPoints(svg: SVGSVGElement): SVGPathElement {
		const path = svg.querySelector("path[data-id]") as SVGPathElement;
		const pts = [
			{ x: 85, y: 50 },
			{ x: 110, y: 50 },
			{ x: 140, y: 50 },
			{ x: 170, y: 50 },
		];
		path.setAttribute("data-points", btoa(JSON.stringify(pts)));
		path.setAttribute("d", "M 85,50 L 110,50 L 140,50 L 170,50");
		return path;
	}

	it("拖动带冗余共线点的直线端点：整条线跟随，不会折弯成折线", () => {
		const { el, svg } = makeHarness();
		setStraightWithRedundantPoints(svg);
		press(el, "v");
		down(svg, 120, 50); // 选中连线
		up(); // 结束这次手势，避免与随后的端点拖动并发
		const handles = el.querySelectorAll(".best-mermaid-tune-layer circle.bm-tune-handle");
		expect(handles.length).toBe(2);

		down(handles[1], 170, 50);
		move(170, 80);
		up();

		const pts = points(svg);
		expect(pts).toHaveLength(2);
		expect(pts[0].x).toBe(85);
		expect(pts[1].x).toBe(170);
	});

	it("端点被拖到节点背面时改锚到面向线段的一侧（路径不穿过节点）", () => {
		const { el, svg } = makeHarness();
		press(el, "v");
		down(svg, 120, 50); // 选中连线
		up();
		const handles = el.querySelectorAll(".best-mermaid-tune-layer circle.bm-tune-handle");

		down(handles[1], 170, 50);
		move(240, 50); // 指针在 B 的右侧
		up();

		const pts = points(svg);
		// 相邻点在左侧，端点必须留在左侧，否则连线会从节点内部穿过、箭头被节点盖住
		expect(pts[pts.length - 1].x).toBe(170);
	});
});
