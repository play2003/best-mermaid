/**
 * 样式卡：一套样式的完整自描述数据（名称 + 完整配置 + 预览色板）。
 * 新增样式 = 新增一份这样的数据，解析链与渲染管线零改动。
 */
/** 卡片展示文案（名称/介绍）的多语言版本 */
export interface StyleText {
	name: string;
	description?: string;
}

export interface StyleCard {
	/** 稳定唯一 id（如 "midnight"），被引用不靠名字 */
	id: string;
	/** 默认（英文）名称；中文等语言见 translations */
	name: string;
	description?: string;
	/** 按语言的名称/介绍覆盖，如 { zh: { name: "靛夜", description: "…" } } */
	translations?: Record<string, StyleText>;
	/** 卡片缩略色板；dynamic 卡为空数组，UI 渲染渐变占位 */
	swatches: string[];
	/** dynamic=跟随主题（token 经 ThemeResolver 探针解析）| static=固定配色（值直传） */
	mode: "dynamic" | "static";
	config: {
		themeVariables: Record<string, string>;
		themeCSS: string;
		/** 布局基线（layout 引擎选择、flowchart 间距等），图内 init 指令可覆盖 */
		diagramConfig?: Record<string, unknown>;
	};
}
