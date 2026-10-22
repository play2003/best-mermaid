import { describe, it, expect, vi } from "vitest";
import { InteractionService } from "../src/services/interaction";

function setup() {
	const container = document.createElement("div");
	container.dataset.bmScale = "2"; // 放大态：拖拽已启用
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	const btn = document.createElement("button");
	btn.className = "best-mermaid-export";
	container.appendChild(svg);
	container.appendChild(btn);
	document.body.appendChild(container);
	container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
	const capture = vi.fn();
	(container as unknown as { setPointerCapture: typeof capture }).setPointerCapture = capture;
	new InteractionService(() => true).attach(container, svg);
	return { container, svg, btn, capture };
}

describe("交互层：导出按钮不参与缩放/拖拽/双击手势", () => {
	it("按钮上的 pointerdown 不触发拖拽捕获", () => {
		const { btn, capture } = setup();
		btn.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
		expect(capture).not.toHaveBeenCalled();
	});

	it("对照：svg 上的 pointerdown 正常触发拖拽捕获", () => {
		const { svg, capture } = setup();
		svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
		expect(capture).toHaveBeenCalledTimes(1);
	});

	it("按钮上的 ctrl+wheel 不被拦截", () => {
		const { btn } = setup();
		const wheel = new WheelEvent("wheel", { ctrlKey: true, bubbles: true, cancelable: true });
		btn.dispatchEvent(wheel);
		expect(wheel.defaultPrevented).toBe(false);
	});

	it("放大态 pointerdown 立即阻止默认行为并禁用选择（回归：拖拽时偶发选中文字）", () => {
		const { container, svg } = setup();
		const down = new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
		svg.dispatchEvent(down);

		expect(down.defaultPrevented).toBe(true); // 选区不会在阈值判定前启动
		expect(container.style.userSelect).toBe("none");
	});

	it("抬手后恢复文字选择", () => {
		const { container, svg } = setup();
		svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }));
		svg.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
		expect(container.style.userSelect).toBe("");
	});

	it("缩放时清除图内的文字选区（回归：1x 选中后放大高亮残留）", () => {
		const { container, svg } = setup();
		const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
		text.textContent = "hello";
		svg.appendChild(text);

		const range = document.createRange();
		range.selectNodeContents(text);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
		expect(selection.isCollapsed).toBe(false);

		container.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, bubbles: true, cancelable: true }));
		expect(selection.isCollapsed).toBe(true);
	});

	it("页面其他位置的选区不受缩放影响", () => {
		const { container } = setup();
		const outside = document.createElement("p");
		outside.textContent = "outside text";
		document.body.appendChild(outside);

		const range = document.createRange();
		range.selectNodeContents(outside);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);

		container.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, bubbles: true, cancelable: true }));
		expect(selection.isCollapsed).toBe(false);
	});
});
