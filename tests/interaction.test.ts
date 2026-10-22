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
});
