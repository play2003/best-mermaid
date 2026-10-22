import type { MarkdownPostProcessorContext } from "obsidian";
import type { PipelineDeps, ThemeProfile } from "../types";
import { resolveLayout } from "./layout";
import { buildPngFilename } from "../services/export";

/**
 * 代码块处理器：渲染管线的调度入口。
 * 职责极薄 —— 防抖调度 + 容器管理，不含渲染逻辑。
 */
export class MermaidBlockProcessor {
	private timers = new WeakMap<HTMLElement, number>();
	/** 每容器渲染序号：仅最新一轮可落笔，防止并发渲染双写 */
	private seq = new WeakMap<HTMLElement, number>();
	/** 每笔记的图序号计数器（导出文件名用） */
	private figureCounters = new Map<string, number>();
	/** 渲染配方版本：样式/主题/对齐等变化时 +1，用于识别懒加载区块的过期渲染 */
	private version = 0;
	/** 监听懒加载区块进入 DOM，补渲染版本过期的容器 */
	private observer: MutationObserver | null = null;
	/** 每容器守卫：内置 mermaid 渲染器覆盖我方输出时立即夺回（事件驱动，无窗口期） */
	private guards = new Map<HTMLElement, MutationObserver>();

	constructor(private deps: PipelineDeps) {}

	/** 插件 onload 时启动（onunload 调 stopWatch 清理） */
	startWatch(): void {
		if (this.observer) return;
		this.observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				for (const node of Array.from(m.addedNodes)) {
					if (!(node instanceof HTMLElement)) continue;
					const targets = node.matches(".best-mermaid-container")
						? [node]
						: Array.from(node.querySelectorAll<HTMLElement>(".best-mermaid-container"));
					for (const el of targets) {
						const src = el.dataset.bmSource;
						if (src !== undefined && el.dataset.bmVersion !== String(this.version)) {
							void this.render(src, el);
						}
					}
				}
			}
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	stopWatch(): void {
		this.observer?.disconnect();
		this.observer = null;
		for (const guard of this.guards.values()) guard.disconnect();
		this.guards.clear();
		this.figureCounters.clear();
	}

	handle = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		// 记录来源笔记与图序号（导出文件名 = 笔记名 + 序号）；dataset 随容器克隆保留
		const sourcePath = ctx.sourcePath ?? "";
		if (el.dataset.bmSourcePath !== sourcePath) {
			el.dataset.bmSourcePath = sourcePath;
			delete el.dataset.bmFigureIndex;
		}
		if (!el.dataset.bmFigureIndex) {
			const next = (this.figureCounters.get(sourcePath) ?? 0) + 1;
			this.figureCounters.set(sourcePath, next);
			el.dataset.bmFigureIndex = String(next);
		}

		const prev = this.timers.get(el);
		if (prev !== undefined) window.clearTimeout(prev);

		const timer = window.setTimeout(() => {
			this.timers.delete(el);
			void this.render(source, el);
		}, this.deps.getSettings().debounceMs);

		this.timers.set(el, timer);
	};

	/**
	 * 主题/样式切换等场景：清缓存后全量重渲染。
	 * 以 DOM 为准收集存活容器，不信任内存引用——启动时 Obsidian 在离屏分离树上
	 * 跑处理器链，挂载时的容器与处理器见到的可能不是同一节点，
	 * 内存集合里会残留"尸体"引用，导致部分图漏更新。
	 */
	rerenderAll(): void {
		this.version++; // 使所有现存渲染过期
		for (const el of Array.from(document.querySelectorAll<HTMLElement>(".best-mermaid-container"))) {
			const src = el.dataset.bmSource;
			if (src !== undefined) void this.render(src, el);
		}
	}

	private async render(source: string, el: HTMLElement, opts: { skipDebounce?: boolean } = {}): Promise<void> {
		// 渲染序号：容器上同刻只允许最新一轮渲染落笔（守卫夺回与排队渲染并发时，
		// 旧一轮的 await 迟于新一轮完成，会把重复 SVG 叠加写入）
		const seq = (this.seq.get(el) ?? 0) + 1;
		this.seq.set(el, seq);

		// 注意：不做 isConnected 守卫——启动时 Obsidian 在离屏分离树上跑处理器链，
		// connected=false 是合法的"延迟挂载"状态，渲染结果会随后续挂载显示。
		// 若容器真被替换，代价只是一次多余渲染，新一代容器会走自己的渲染并胜出。
		el.dataset.bmSource = source;
		el.dataset.bmVersion = String(this.version);
		el.addClass("best-mermaid-container");
		// 水平对齐：容器可能复用，先清旧类再加新类
		el.removeClass("bm-align-left", "bm-align-center", "bm-align-right");
		el.addClass(`bm-align-${this.deps.getSettings().imageAlign}`);
		this.clearOwn(el);

		try {
			// 解析链：图上 bm-style 指令 > 全局默认样式 > 内置兜底
			const normalized = this.deps.normalizer.normalize(source);
			const settings = this.deps.getSettings();
			const style = this.deps.registry.get(normalized.styleId ?? settings.defaultStyleId)
				?? this.deps.registry.getFallback();
			const theme = this.deps.themeResolver.resolve(style);
			const directive = normalized.directive;
			const cacheKey = this.deps.normalizer.cacheKey(
				normalized,
				theme.id,
				resolveLayout(directive, theme, this.deps.getSettings().layoutEngine).layout,
			);

			let svg = this.deps.cache.get(cacheKey);
			if (svg === undefined) {
				svg = await this.deps.engine.render(normalized.source, theme, directive);
				this.deps.cache.put(cacheKey, svg);
			}

			// await 期间可能有更新一轮的渲染已启动：本轮过期，放弃落笔
			if (this.seq.get(el) !== seq) return;

			const filename = buildPngFilename(
				el.dataset.bmSourcePath ?? "",
				el.dataset.bmFigureIndex ?? "1",
			);
			const background = this.exportBackground(theme, directive);

			const svgEl = this.deps.postProcessor.enhance(el, svg, (target) =>
				this.deps.openExportDialog(target, { filename, background }),
			);
			if (svgEl) this.deps.interaction.attach(el, svgEl);
			this.attachGuard(el, source);
		} catch (e) {
			this.deps.errorBoundary.render(el, e, source);
		}
	}

	/**
	 * 容器守卫（事件驱动的竞态仲裁）：
	 * 内置 mermaid 渲染器与本插件会先后往同一代码块写入 SVG（后写者胜），
	 * 它可能在我们渲染完成后很久才落笔（大文档/标签页重开）——
	 * 定时窗口验证会漏，这里改为每容器常驻 MutationObserver：
	 * 一旦发现容器里出现"无我方 wrap 的 SVG"（内置渲染器覆盖），立即重渲染夺回。
	 * 自身的渲染写入会触发本观察器但条件不成立，天然无循环。
	 */
	private attachGuard(el: HTMLElement, source: string): void {
		this.guards.get(el)?.disconnect();
		const guard = new MutationObserver(() => {
			if (!el.isConnected) {
				guard.disconnect();
				this.guards.delete(el);
				return;
			}
			if (!el.querySelector(".best-mermaid-wrap") && el.querySelector("svg")) {
				void this.render(source, el);
			}
		});
		guard.observe(el, { childList: true });
		this.guards.set(el, guard);
	}

	/**
	 * 导出 PNG 的底色：与渲染优先级一致——图内 init 指令 > 样式卡解析结果 > 页面背景 > 白。
	 */
	private exportBackground(theme: ThemeProfile, directive: Record<string, unknown> | null): string {
		const dv = directive?.themeVariables;
		if (dv && typeof dv === "object" && !Array.isArray(dv)) {
			const v = (dv as Record<string, unknown>).background;
			if (typeof v === "string" && v.trim()) return v;
		}
		const bg = theme.themeVariables.background;
		if (typeof bg === "string" && bg.trim()) return bg;
		const bodyBg = getComputedStyle(document.body).backgroundColor;
		return bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent" ? bodyBg : "#ffffff";
	}

	/**
	 * 容器是共享宿主（角标、Mermaid Exporter 等其他插件都会注入节点），
	 * 重渲染只清自己的节点，外部注入的原样保留——
	 * 其他插件对同一容器通常有"只注入一次"守卫，清掉了它们不会补回来。
	 */
	private clearOwn(el: HTMLElement): void {
		const own = ["best-mermaid-wrap", "best-mermaid-badge", "best-mermaid-error", "best-mermaid-export"];
		for (const child of Array.from(el.children)) {
			if (own.some((cls) => child.hasClass(cls))) child.remove();
		}
	}
}
