import type { PngExportOptions, PngExporter } from "../types";

/** canvas 像素上限：桌面 Electron 的保守安全值 */
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_AREA = 4096 * 4096;
/** Image 加载 SVG 的超时（毫秒） */
const IMAGE_TIMEOUT = 15_000;

const INVALID_FILENAME = /[\\/:*?"<>|]+/g;

/** 文件名：笔记名去扩展名/非法字符 + 图序号（不含 .png） */
export function buildPngFilename(sourcePath: string, figureIndex: string | number): string {
	const base = (sourcePath.split("/").pop() ?? "")
		.replace(/\.(?:md|markdown)$/i, "")
		.replace(INVALID_FILENAME, "-")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+|[.\s-]+$/g, "")
		.slice(0, 80);
	const index = String(figureIndex).replace(/\D/g, "") || "1";
	return `${base || "mermaid"}-${index}`;
}

/** 按 canvas 上限收缩光栅化倍率，返回最终倍率与像素尺寸 */
export function fitExportSize(
	width: number,
	height: number,
	requestedScale = 2,
): { scale: number; pixelWidth: number; pixelHeight: number } {
	if (!(width > 0) || !(height > 0)) throw new Error("Invalid SVG size for export");
	const requested = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 2;
	const scale = Math.min(
		requested,
		MAX_CANVAS_SIDE / width,
		MAX_CANVAS_SIDE / height,
		Math.sqrt(MAX_CANVAS_AREA / (width * height)),
	);
	return {
		scale,
		pixelWidth: Math.max(1, Math.floor(width * scale)),
		pixelHeight: Math.max(1, Math.floor(height * scale)),
	};
}

/**
 * 导出服务：当前图导出 SVG / PNG。
 *
 * 字体说明：SVG 经 blob URL 加载进 <img> 后是独立文档——mermaid 自带 <style>
 * （配色/字号/fontFamily）会保留，但页面级 @font-face 不会继承；我们的 fontFamily
 * 来自系统字体栈，通常可正常光栅化，自定义主题字体在无系统同名时退化到栈内下一字体。
 */
export class ExportService implements PngExporter {
	/** 光栅化为 PNG Blob（不保存）；保存方式由调用方决定（原生对话框/下载） */
	async renderPng(svg: SVGSVGElement, options: PngExportOptions = {}): Promise<Blob> {
		const { clone, width, height } = this.prepareClone(svg);
		const scale = options.scale ?? 2;
		const fit = fitExportSize(width, height, scale);
		if (fit.scale < scale) {
			console.warn(
				`[best-mermaid] diagram too large for ${scale}x export, downscaled to ${fit.scale.toFixed(2)}x`,
			);
		}

		const serialized = new XMLSerializer().serializeToString(clone);
		const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
		try {
			const img = await this.loadImage(url);
			const canvas = document.createElement("canvas");
			canvas.width = fit.pixelWidth;
			canvas.height = fit.pixelHeight;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Failed to get 2d context for PNG export");

			// 先按设备像素铺底色（在 scale 之前），避免透明 PNG
			ctx.fillStyle = options.background?.trim() || "#ffffff";
			ctx.fillRect(0, 0, fit.pixelWidth, fit.pixelHeight);
			ctx.scale(fit.scale, fit.scale);
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(img, 0, 0);

			return await this.toBlob(canvas);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	/** 无对话框时的兜底导出：直接走浏览器下载 */
	async exportPng(svg: SVGSVGElement, options: PngExportOptions = {}): Promise<void> {
		const blob = await this.renderPng(svg, options);
		this.download(blob, `${options.filename ?? "mermaid"}.png`);
	}

	exportSvg(svg: SVGSVGElement, filename = "mermaid"): void {
		const { clone, width, height } = this.prepareClone(svg);
		clone.setAttribute("width", String(Math.ceil(width)));
		clone.setAttribute("height", String(Math.ceil(height)));
		const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
			type: "image/svg+xml;charset=utf-8",
		});
		this.download(blob, `${filename}.svg`);
	}

	/**
	 * 克隆并规整：测量用原始（活体）SVG；clone 上清除交互缩放/拉伸，
	 * 保留根 id（mermaid 11 的 <style> 以 #<svgId> 作用域编译，删 id 会丢全部样式）。
	 *
	 * 必须给 clone 设定明确的 width/height：mermaid 的 svg 是 width="100%"，
	 * 作为独立图片加载时没有确定固有尺寸，光栅化会按浏览器回退尺寸裁切（导出图不完整）。
	 */
	private prepareClone(svg: SVGSVGElement): { clone: SVGSVGElement; width: number; height: number } {
		const { width, height } = this.measure(svg);
		const clone = svg.cloneNode(true) as SVGSVGElement;
		clone.style.transform = "";
		clone.style.transition = "";
		clone.style.maxWidth = "none";
		clone.setAttribute("width", String(Math.ceil(width)));
		clone.setAttribute("height", String(Math.ceil(height)));
		return { clone, width, height };
	}

	/** 测量优先级：viewBox（mermaid 必写）→ 活体 getBBox → 布局尺寸 → 宽高属性 */
	private measure(svg: SVGSVGElement): { width: number; height: number } {
		const viewBox = svg.viewBox?.baseVal;
		if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
			return { width: viewBox.width, height: viewBox.height };
		}
		try {
			const box = svg.getBBox();
			if (box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
		} catch {
			// 未挂载/布局不可用时 getBBox 可能抛错，继续回退
		}
		const rect = svg.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
		const w = Number(svg.getAttribute("width"));
		const h = Number(svg.getAttribute("height"));
		if (w > 0 && h > 0) return { width: w, height: h };
		throw new Error("Unable to measure SVG for export");
	}

	private loadImage(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const timer = window.setTimeout(
				() => reject(new Error("Timed out loading SVG for PNG export")),
				IMAGE_TIMEOUT,
			);
			const settle = (fn: () => void) => {
				window.clearTimeout(timer);
				fn();
			};
			img.decoding = "async";
			img.onload = () => settle(() => resolve(img));
			img.onerror = () => settle(() => reject(new Error("Failed to load SVG for PNG export")));
			img.src = url;
		});
	}

	private toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
		return new Promise((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode PNG"))),
				"image/png",
			);
		});
	}

	private download(blob: Blob, filename: string): void {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	}
}
