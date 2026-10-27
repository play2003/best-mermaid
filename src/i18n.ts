import { moment } from "obsidian";

/**
 * 极简 i18n：语言源为 Obsidian 全局语言设置（moment.locale()）。
 * 词表未命中时回退英文，再回退 key 本身。
 */
type Dict = Record<string, string>;

const en: Dict = {
	layoutEngine: "Layout engine",
	layoutEngineDesc: "elk provides professional orthogonal edge routing (loaded on demand)",
	engineAuto: "Auto (follow style)",
	engineDagre: "dagre (default)",
	engineElk: "elk (experimental)",
	horizontalAlignment: "Horizontal alignment",
	horizontalAlignmentDesc: "Horizontal position of rendered diagrams",
	alignLeft: "Left",
	alignCenter: "Center",
	alignRight: "Right",
	renderDebounce: "Render debounce",
	renderDebounceDesc: "Delay in milliseconds before re-rendering while typing",
	enableZoom: "Enable zoom and pan",
	styles: "Styles",
	stylesDesc: "Default style for diagrams. Override per diagram with %% bm-style: <id> %%",
	setAsDefault: "Set as default",
	current: "Current",
	delete: "Delete",
	followsTheme: "Follows theme",
	fixedPalette: "Fixed palette",
	errorTitle: "Diagram syntax error",
	errorTitleTemplate: "Diagram syntax error (line {n})",
	unquotedParens: "A node label contains unquoted parentheses — mermaid treats \"(\" as the start of a new node shape. Wrap the label in quotes to fix it:",
	errorSuggestion: "Suggested fix:",
	errorDetails: "Raw error",
	renderFailed: "Mermaid render failed",
	nearLine: "(near line",
	exportPng: "Export PNG",
	exportTitle: "Export diagram as PNG",
	fileName: "File name",
	quality: "Image quality",
	exportBtn: "Export",
	cancel: "Cancel",
	exportedTo: "Exported to",
	exportCancelled: "Export cancelled",
	exportFailed: "Export failed",
	downloadsFolder: "Downloads folder: ",
};

const zh: Dict = {
	layoutEngine: "布局引擎",
	layoutEngineDesc: "elk 提供专业级正交布线（按需加载）",
	engineAuto: "自动（跟随样式）",
	engineDagre: "dagre（默认）",
	engineElk: "elk（实验性）",
	horizontalAlignment: "水平对齐",
	horizontalAlignmentDesc: "渲染结果在容器内的水平位置",
	alignLeft: "左对齐",
	alignCenter: "居中",
	alignRight: "右对齐",
	renderDebounce: "渲染防抖",
	renderDebounceDesc: "输入源码时延迟渲染的毫秒数",
	enableZoom: "启用缩放与平移",
	styles: "样式",
	stylesDesc: "图的默认样式。图内可用 %% bm-style: <id> %% 指令覆盖",
	setAsDefault: "设为默认",
	current: "当前",
	delete: "删除",
	followsTheme: "跟随主题",
	fixedPalette: "固定配色",
	errorTitle: "图表语法错误",
	errorTitleTemplate: "图表语法错误（第 {n} 行）",
	unquotedParens: "节点文字包含未加引号的括号——mermaid 会把 \"(\" 当作新节点形状的起始符。给标签加上引号即可修复：",
	errorSuggestion: "建议修复：",
	errorDetails: "原始错误信息",
	renderFailed: "Mermaid 渲染失败",
	nearLine: "（疑似第",
	exportPng: "导出 PNG",
	exportTitle: "导出图表为 PNG",
	fileName: "文件名",
	quality: "图片质量",
	exportBtn: "导出",
	cancel: "取消",
	exportedTo: "已导出到",
	exportCancelled: "已取消导出",
	exportFailed: "导出失败",
	downloadsFolder: "下载目录：",
};

export function t(key: string): string {
	const isZh = /^zh\b/i.test(moment.locale());
	return (isZh ? zh[key] : en[key]) ?? en[key] ?? key;
}

/** 样式卡文案本地化：中文取 translations.zh，其余语言用卡片默认（英文）文案 */
export function tStyle(style: {
	name: string;
	description?: string;
	translations?: Record<string, { name: string; description?: string }>;
}): { name: string; description?: string } {
	const isZh = /^zh\b/i.test(moment.locale());
	const tr = isZh ? style.translations?.zh : undefined;
	return {
		name: tr?.name ?? style.name,
		description: tr?.description ?? style.description,
	};
}
