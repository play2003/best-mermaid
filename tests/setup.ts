/**
 * 测试环境装配：
 * 1. 补齐 Obsidian 对 HTMLElement 的扩展方法（addClass/empty/createDiv...），
 *    使依赖 Obsidian DOM 工具的生产代码可直接在 jsdom 中运行
 * 2. 补齐 jsdom 缺失的 SVG 布局 API（getBBox），mermaid 渲染依赖
 */

const proto: any = (globalThis as any).HTMLElement?.prototype;

if (proto && !proto.addClass) {
	proto.addClass = function (...classes: string[]) {
		this.classList.add(...classes);
		return this;
	};
	proto.removeClass = function (...classes: string[]) {
		this.classList.remove(...classes);
		return this;
	};
	proto.hasClass = function (cls: string) {
		return this.classList.contains(cls);
	};
	proto.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
		return this;
	};
	proto.setText = function (text: string) {
		this.textContent = text;
		return this;
	};
	const make = (tag: string) =>
		function (this: HTMLElement, opts?: { cls?: string; text?: string }) {
			const el = this.ownerDocument!.createElement(tag);
			if (opts?.cls) el.className = opts.cls;
			if (opts?.text) el.textContent = opts.text;
			this.appendChild(el);
			return el;
		};
	proto.createDiv = make("div");
	proto.createSpan = make("span");
	proto.createEl = function (this: HTMLElement, tag: string, opts?: { cls?: string; text?: string }) {
		const el = this.ownerDocument!.createElement(tag);
		if (opts?.cls) el.className = opts.cls;
		if (opts?.text) el.textContent = opts.text;
		this.appendChild(el);
		return el;
	};
}

// jsdom 没有 SVG 元素布局测量，mermaid 渲染依赖 getBBox
for (const name of ["SVGGElement", "SVGTextElement", "SVGGraphicsElement", "SVGElement"]) {
	const Ctor = (globalThis as any)[name];
	if (Ctor && !Ctor.prototype.getBBox) {
		Ctor.prototype.getBBox = function () {
			return { x: 0, y: 0, width: 120, height: 40 };
		};
	}
}
