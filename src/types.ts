/** 共享类型定义。pipeline 与 services 都只依赖本文件，避免相互引用。 */

import type { StyleRegistry } from "./styles/registry";

/**
 * 主题画像：ThemeResolver 的产物，可直接传给 RenderEngine。
 * id 参与缓存键 —— 主题变化 ⇒ id 变化 ⇒ 缓存失效。
 */
export interface ThemeProfile {
	/** 画像标识（如 "midnight@#0f1a2b..."），由 Resolver 生成 */
	id: string;
	/** mermaid 基础主题，恒为 "base"（官方唯一完整支持 themeVariables 定制的主题） */
	baseTheme: "base";
	themeVariables: Record<string, string>;
	/** 注入到 SVG 内部的自定义 CSS */
	themeCSS: string;
	/** 布局基线（来自样式卡，如图线曲直、层间距），优先级低于图内 init 指令 */
	diagramConfig?: Record<string, unknown>;
}

/** 微调数据的锚边：左/右/上/下 */
export type AnchorSide = "l" | "r" | "t" | "b";

/** 节点微调：svg 用户坐标下的中心点与尺寸 */
export interface NodeTune {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** 连线微调：端点锚边（用户意图）与完整折线点集（仅拖动整段后保存） */
export interface EdgeTune {
	from?: string;
	to?: string;
	src?: AnchorSide;
	dst?: AnchorSide;
	pts?: Array<[number, number]>;
}

/**
 * 微调覆盖数据：mermaid 语法无法表达逐节点尺寸/逐边走向，
 * 以 %% bm-tune: {...} %% 注释随源码保存，渲染后重放。
 */
export interface BmTuneData {
	v: 1;
	nodes?: Record<string, NodeTune>;
	edges?: Record<string, EdgeTune>;
}

export type TuneError = "syntax" | "version" | null;

/** SourceNormalizer 的产物 */
export interface NormalizedSource {
	/** 剥离指令、剔除噪声后的源码 */
	source: string;
	/** 图内 %%{init}%% 解析结果，多指令时后者覆盖前者；无则 null */
	directive: Record<string, unknown> | null;
	/** 图上指定的样式 id（源码指令 %% bm-style: xx %%），无则 null → 用全局默认 */
	styleId: string | null;
	/** 微调覆盖数据（源码指令 %% bm-tune: {...} %%），无则 null */
	tune: BmTuneData | null;
	/** 微调指令解析失败原因：syntax=JSON 不可解析；version=来自更新版本的数据 */
	tuneError: TuneError;
}

/** PNG 导出选项 */
export interface PngExportOptions {
	/** 不含扩展名的基础文件名，如 "架构笔记-2" */
	filename?: string;
	/** canvas 底色，通常是 themeVariables.background */
	background?: string;
	/** 光栅化倍率，默认 2 */
	scale?: number;
}

/** 导出器窄接口：processor 依赖此接口，便于测试注入 Fake */
export interface PngExporter {
	exportPng(svg: SVGSVGElement, options?: PngExportOptions): Promise<void>;
}

/** 渲染管线各阶段共享的依赖注入容器 */
export interface PipelineDeps {
	getSettings: () => import("./settings").BestMermaidSettings;
	registry: StyleRegistry;
	cache: import("./services/cache").RenderCache;
	themeResolver: import("./pipeline/theme-resolver").ThemeResolver;
	engine: import("./pipeline/engine").RenderEngine;
	normalizer: import("./pipeline/normalizer").SourceNormalizer;
	postProcessor: import("./pipeline/post-processor").PostProcessor;
	errorBoundary: import("./services/error-boundary").ErrorBoundary;
	interaction: import("./services/interaction").InteractionService;
	/** V 键微调模式（会话与 UI 归 services 层） */
	tune: import("./services/tune-mode").TuneModeService;
	/** 打开导出对话框（UI 归入口层，pipeline 只发请求） */
	openExportDialog: (svg: SVGSVGElement, defaults: PngExportOptions) => void;
}
