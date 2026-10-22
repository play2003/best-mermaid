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

/** SourceNormalizer 的产物 */
export interface NormalizedSource {
	/** 剥离指令、剔除噪声后的源码 */
	source: string;
	/** 图内 %%{init}%% 解析结果，多指令时后者覆盖前者；无则 null */
	directive: Record<string, unknown> | null;
	/** 图上指定的样式 id（源码指令 %% bm-style: xx %%），无则 null → 用全局默认 */
	styleId: string | null;
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
}
