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

// Obsidian 全局 API 桩（生产代码遵循审查规范使用这些助手）
const anyGlobal = globalThis as any;
if (typeof anyGlobal.createEl !== "function") {
	anyGlobal.createEl = (tag: string) => document.createElement(tag);
	anyGlobal.createDiv = () => document.createElement("div");
	anyGlobal.createSpan = () => document.createElement("span");
}
const nodeProto: any = (globalThis as any).Node?.prototype;
if (nodeProto && !nodeProto.instanceOf) {
	nodeProto.instanceOf = function (Type: any) {
		return this instanceof Type;
	};
}
const elemProto: any = (globalThis as any).Element?.prototype;
if (elemProto && !elemProto.setCssStyles) {
	elemProto.setCssStyles = function (styles: Record<string, string>) {
		Object.assign(this.style, styles);
	};
	elemProto.setCssProps = function (props: Record<string, string>) {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	};
}

// jsdom 没有 SVG 元素布局测量，mermaid 渲染依赖 getBBox 与文本测宽
for (const name of ["SVGGElement", "SVGTextElement", "SVGGraphicsElement", "SVGElement"]) {
	const Ctor = (globalThis as any)[name];
	if (!Ctor) continue;
	if (!Ctor.prototype.getBBox) {
		Ctor.prototype.getBBox = function () {
			return { x: 0, y: 0, width: 120, height: 40 };
		};
	}
	if (!Ctor.prototype.getComputedTextLength) {
		Ctor.prototype.getComputedTextLength = function () {
			return (this.textContent ?? "").length * 8;
		};
	}
}
