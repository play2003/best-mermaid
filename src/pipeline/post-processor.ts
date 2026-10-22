/**
 * SVG 后处理：把 mermaid 输出的 SVG 字符串写成容器内 DOM，
 * 并做尺寸/交互所需的增强。路径几何完全交给布局引擎（elk/dagre），不做二次加工。
 */
export class PostProcessor {
	/** @returns 写入的 <svg> 元素 */
	enhance(el: HTMLElement, svgString: string): SVGSVGElement | null {
		// 注意：不 empty 容器（共享宿主，外部插件节点由 processor 的 clearOwn 保护）
		// svg 包一层 wrapper：水平对齐的 flex 布局只作用于 svg，
		// 容器内的其他子节点（角标、其他插件注入的按钮）不参与布局
		const wrap = el.createDiv({ cls: "best-mermaid-wrap" });

		// 用 DOMParser + importNode 注入（官方规范禁用 innerHTML；
		// DOMParser 创建的文档中脚本不会执行，天然安全）
		const parsed = new DOMParser().parseFromString(svgString, "image/svg+xml");
		const parsedSvg = parsed.documentElement;
		if (!parsedSvg || parsedSvg.nodeName !== "svg") return null;
		const svg = document.importNode(parsedSvg, true);
		if (!(svg instanceof SVGSVGElement)) return null;
		wrap.appendChild(svg);

		// 保留 mermaid 计算的自然尺寸上限（内联 max-width: Npx）：
		// 窄图不拉伸到容器宽度（否则 viewBox 等比放大导致字号异常），
		// 只在容器更窄时按比例缩小
		if (!svg.style.maxWidth) svg.style.maxWidth = "100%";

		// 右上角低调角标，标识渲染来源（悬停时变清晰）
		el.createDiv({ cls: "best-mermaid-badge", text: "best-mermaid" });

		// TODO(M3)：为交互（节点点击、全屏预览）注入 data 属性
		return svg;
	}
}
