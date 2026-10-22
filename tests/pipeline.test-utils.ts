import { RenderCache } from "../src/services/cache";
import { ErrorBoundary } from "../src/services/error-boundary";
import { InteractionService } from "../src/services/interaction";
import { SourceNormalizer } from "../src/pipeline/normalizer";
import { ThemeResolver } from "../src/pipeline/theme-resolver";
import { RenderEngine } from "../src/pipeline/engine";
import { PostProcessor } from "../src/pipeline/post-processor";
import { StyleRegistry } from "../src/styles/registry";
import { follow } from "../src/styles/builtin/follow";
import { midnight } from "../src/styles/builtin/midnight";
import { paper } from "../src/styles/builtin/paper";
import { terra } from "../src/styles/builtin/terra";
import type { BestMermaidSettings } from "../src/settings";
import type { PipelineDeps, PngExportOptions } from "../src/types";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待条件成立（替代固定 sleep，避免机器负载导致的偶发失败） */
export async function waitFor(cond: () => boolean, timeout = 8000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeout) throw new Error("waitFor timeout");
		await sleep(50);
	}
}

export const GRAPH = "flowchart LR\n    A[Start] --> B[End]";

/** 测试用导出对话框：只记录打开请求，不触达 Obsidian UI */
export class FakeExportDialog {
	calls: Array<{ svg: SVGSVGElement; options: PngExportOptions }> = [];
	readonly open = (svg: SVGSVGElement, options: PngExportOptions): void => {
		this.calls.push({ svg, options });
	};
}

export function makeDeps(
	overrides: Partial<BestMermaidSettings> = {},
	extraDeps: Partial<PipelineDeps> = {},
) {
	const settings: BestMermaidSettings = {
		debounceMs: 0,
		zoomEnabled: false,
		cacheLimit: 50,
		fallbackToBuiltin: false,
		defaultStyleId: "follow",
		imageAlign: "left",
		layoutEngine: "auto",
		userStyles: [],
		...overrides,
	};
	const registry = new StyleRegistry([follow, midnight, paper, terra]);
	const deps = {
		getSettings: () => settings,
		registry,
		cache: new RenderCache(50),
		themeResolver: new ThemeResolver(),
		engine: new RenderEngine("test", () => settings.layoutEngine),
		normalizer: new SourceNormalizer("11", "0.1.0"),
		postProcessor: new PostProcessor(),
		errorBoundary: new ErrorBoundary(),
		interaction: new InteractionService(() => settings.zoomEnabled),
		openExportDialog: () => {},
		...extraDeps,
	};
	return { deps, settings };
}
