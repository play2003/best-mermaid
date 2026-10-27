import { describe, it, expect, vi, afterEach } from "vitest";
import { TuneModeService } from "../src/services/tune-mode";
import type { TuneModeDeps } from "../src/services/tune-mode";
import { sleep, waitFor } from "./pipeline.test-utils";

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
