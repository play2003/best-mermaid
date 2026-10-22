import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPngFilename, fitExportSize, ExportService } from "../src/services/export";

describe("buildPngFilename", () => {
	it("去扩展名 + 非法字符替换 + 序号", () => {
		expect(buildPngFilename("Folder/架构:笔记?.md", "2")).toBe("架构-笔记-2");
		expect(buildPngFilename("Notes/a  b.md", 1)).toBe("a b-1");
	});
	it("空路径退化为 mermaid", () => {
		expect(buildPngFilename("", 1)).toBe("mermaid-1");
		expect(buildPngFilename("", "x")).toBe("mermaid-1");
	});
});

describe("fitExportSize", () => {
	it("常规图保持请求倍率", () => {
		expect(fitExportSize(100, 50, 2)).toEqual({ scale: 2, pixelWidth: 200, pixelHeight: 100 });
	});
	it("超大图按 canvas 上限降采样", () => {
		const fit = fitExportSize(20_000, 20_000, 2);
		expect(fit.scale).toBeLessThan(2);
		expect(fit.pixelWidth).toBeLessThanOrEqual(4096);
		expect(fit.pixelHeight).toBeLessThanOrEqual(4096);
	});
	it("非法尺寸抛错", () => {
		expect(() => fitExportSize(0, 100)).toThrow();
	});
});

describe("exportPng 完整管线（mock canvas/Image/URL）", () => {
	afterEach(() => vi.restoreAllMocks());

	it("2x 光栅化、背景填充、下载文件名", async () => {
		const downloads: string[] = [];
		const rects: Array<{ fill: string; args: number[] }> = [];

		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			downloads.push(this.download);
		});
		const ctx = {
			fillStyle: "",
			fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
				rects.push({ fill: ctx.fillStyle, args: [x, y, w, h] });
			}),
			scale: vi.fn(),
			drawImage: vi.fn(),
			imageSmoothingEnabled: true,
			imageSmoothingQuality: "high",
		};
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			ctx as unknown as CanvasRenderingContext2D,
		);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
			cb: BlobCallback,
		) {
			cb(new Blob(["png"], { type: "image/png" }));
		} as never);

		const FakeImage = class {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			decoding = "";
			set src(_v: string) {
				setTimeout(() => this.onload?.(), 0);
			}
		};
		vi.stubGlobal("Image", FakeImage);

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("id", "bm-test");
		svg.setAttribute("viewBox", "0 0 100 50");
		svg.style.transform = "scale(2)";

		const spySerialize = vi.spyOn(XMLSerializer.prototype, "serializeToString");
		await new ExportService().exportPng(svg, { filename: "n-1", background: "#0f172a", scale: 2 });

		expect(downloads).toEqual(["n-1.png"]);
		expect(rects.length).toBeGreaterThan(0);
		expect(rects[0].args.slice(0, 2)).toEqual([0, 0]);

		const serialized = spySerialize.mock.results[0]?.value as string;
		expect(serialized).toContain('id="bm-test"'); // 保留根 id（样式作用域）
		expect(serialized).not.toContain("transform: scale(2)"); // 交互缩放被清除
		// 克隆必须带明确的宽高（mermaid 原 svg 是 width=100%，独立图片会按回退尺寸裁切）
		expect(serialized).toContain('width="100"');
		expect(serialized).toContain('height="50"');
		expect(serialized).not.toContain('width="100%"');

		vi.unstubAllGlobals();
	});
});
