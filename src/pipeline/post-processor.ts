/**
 * SVG 后处理：把 mermaid 输出的 SVG 字符串写成容器内 DOM，
 * 并做尺寸/交互所需的增强。路径几何完全交给布局引擎（elk/dagre），不做二次加工。
 */
import { t } from "../i18n";

/** 导出回调：拿到真实 svg 元素执行导出 */
export type ExportHandler = (svg: SVGSVGElement) => void | Promise<void>;

export class PostProcessor {
	/**
	 * @param onExport 提供时在图的右下角创建导出按钮
	 * @returns 写入的 <svg> 元素
	 */
	enhance(el: HTMLElement, svgString: string, onExport?: ExportHandler): SVGSVGElement | null {
		// 注意：不 empty 容器（共享宿主，外部插件节点由 processor 的 clearOwn 保护）
		// svg 包一层 wrapper：水平对齐的 flex 布局只作用于 svg，
		// 容器内的其他子节点（角标、其他插件注入的按钮）不参与布局
		const wrap = el.createDiv({ cls: "best-mermaid-wrap" });
		// 收缩层：让右下角按钮锚定"图"的实际边界，而不是整行容器的右端
		const figure = wrap.createDiv({ cls: "best-mermaid-figure" });

		// 官方规范禁用 innerHTML；DOMParser 严格 XML 解析优先（脚本不执行，安全）
		const svg = this.parseSvg(svgString);
		// 解析失败必须可见化——曾因静默返回 null 导致部分图无声消失、无错误框
		if (!svg) throw new Error("Failed to parse rendered SVG");
		figure.appendChild(svg);

		if (onExport) this.attachExportButton(figure, svg, onExport);

		// 保留 mermaid 计算的自然尺寸上限（内联 max-width: Npx）：
		// 窄图不拉伸到容器宽度（否则 viewBox 等比放大导致字号异常），
		// 只在容器更窄时按比例缩小
		if (!svg.style.maxWidth) svg.style.maxWidth = "100%";

		// 右上角低调角标，标识渲染来源（悬停时变清晰）
		el.createDiv({ cls: "best-mermaid-badge", text: "best-mermaid" });

		// TODO(M3)：为交互（节点点击、全屏预览）注入 data 属性
		return svg;
	}

	/** 图的右下角导出按钮：常驻低透明度，悬停图表提亮；导出期间禁用防连点 */
	private attachExportButton(figure: HTMLElement, svg: SVGSVGElement, onExport: ExportHandler): void {
		const label = t("exportPng");
		const btn = figure.createEl("button", { cls: "best-mermaid-export", text: "PNG" });
		btn.type = "button";
		btn.title = label;
		btn.setAttribute("aria-label", label);
		btn.addEventListener("click", async (ev) => {
			ev.stopPropagation();
			if (btn.disabled) return;
			btn.disabled = true;
			try {
				await onExport(svg);
			} catch (e) {
				console.warn("[best-mermaid] PNG export failed:", e);
			} finally {
				btn.disabled = false;
			}
		});
	}

	/**
	 * 解析 mermaid 输出的 SVG：
	 * 1) 严格 XML（image/svg+xml）——干净安全的默认路径
	 * 2) XML 失败时用 Range 的 HTML 片段解析器兜底——mermaid 的 htmlLabels 会输出
	 *    HTML 风格标记（如未自闭合的 <br>），在 XML 下是非法文档
	 * 两条路径都是惰性解析，脚本不会执行。
	 */
	private parseSvg(svgString: string): SVGSVGElement | null {
		const xmlDoc = new DOMParser().parseFromString(svgString, "image/svg+xml");
		const root = xmlDoc.documentElement;
		if (root && root.nodeName === "svg") {
			const imported = document.importNode(root, true);
			if (imported instanceof SVGSVGElement) return imported;
		}
		const fragment = document.createRange().createContextualFragment(svgString);
		const svg = fragment.querySelector("svg");
		return svg instanceof SVGSVGElement ? svg : null;
	}
}
