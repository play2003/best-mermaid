import type { StyleCard } from "../types";

/**
 * 跟随主题（dynamic 模板示例）
 * 心理锚点：熟悉、零干扰——图是笔记的配角，视觉语言刻意不设预设，
 * 只保留 6px 中性圆角，其余全部交给当前主题与 mermaid 原生行为。
 */
export const follow: StyleCard = {
	id: "follow",
	name: "Follow theme",
	description: "Colors resolved from the Obsidian theme's CSS variables; follows light/dark automatically",
	translations: {
		zh: { name: "跟随主题", description: "从 Obsidian 当前主题的 CSS 变量解析配色，随亮/暗自动切换" },
	},
	swatches: [],
	mode: "dynamic",
	config: {
		themeVariables: {
			primaryColor: "@accent-fade",
			background: "@bg",
			textColor: "@text",
			secondaryTextColor: "@text-muted",
			lineColor: "@border",
			linkColor: "@link",
		},
		themeCSS: "\n.node rect { rx: 6; }\n.edgeLabel { background-color: transparent; }\n.edgePath .path, path.flowchart-link { stroke-width: 1.5px; }\n",
	},
};
