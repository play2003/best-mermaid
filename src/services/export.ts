/**
 * 导出服务：当前图导出 SVG / PNG。
 * TODO(M3)：命令面板 + 容器右键菜单两个入口。
 */
export class ExportService {
	exportSvg(svg: SVGSVGElement, filename = "mermaid"): void {
		const clone = svg.cloneNode(true) as SVGSVGElement;
		this.inlineSize(clone);
		const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
			type: "image/svg+xml;charset=utf-8",
		});
		this.download(blob, `${filename}.svg`);
	}

	/** TODO(M3)：字体内联（@font-face/字体声明写进 SVG），否则 canvas 光栅化会退化为默认字体 */
	exportPng(svg: SVGSVGElement, scale = 2, filename = "mermaid"): void {
		const clone = svg.cloneNode(true) as SVGSVGElement;
		this.inlineSize(clone);
		const serialized = new XMLSerializer().serializeToString(clone);
		const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));

		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = (clone.clientWidth || img.width) * scale;
			canvas.height = (clone.clientHeight || img.height) * scale;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				URL.revokeObjectURL(url);
				return;
			}
			ctx.scale(scale, scale);
			ctx.drawImage(img, 0, 0);
			URL.revokeObjectURL(url);
			canvas.toBlob((blob) => blob && this.download(blob, `${filename}.png`));
		};
		img.src = url;
	}

	private inlineSize(svg: SVGSVGElement): void {
		const box = svg.getBBox();
		svg.setAttribute("width", String(Math.ceil(box.width)));
		svg.setAttribute("height", String(Math.ceil(box.height)));
	}

	private download(blob: Blob, filename: string): void {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	}
}
