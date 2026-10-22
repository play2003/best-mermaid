import type { StyleCard } from "../types";

/**
 * 论文黑白（static）：印刷风格。
 * 心理锚点：权威、中性、零干扰——面向导出打印/PDF 场景：
 * 近直角节点（2px）与直线是印刷制图的正式惯例，1px 细线让内容而非样式出头，
 * 深灰（非纯黑）降低打印墨量与视觉疲劳，间距紧凑适应纸面密度。
 */
export const paper: StyleCard = {
	id: "paper",
	name: "论文黑白",
	description: "印刷风格：近直角节点、细线深灰，适合导出与打印",
	swatches: ["#ffffff", "#efefef", "#888888", "#111111"],
	mode: "static",
	config: {
		themeVariables: {
			background: "#ffffff",
			primaryColor: "#efefef",
			primaryTextColor: "#111111",
			primaryBorderColor: "#666666",
			textColor: "#222222",
			secondaryTextColor: "#555555",
			lineColor: "#555555",
			arrowheadColor: "#555555",
			clusterBkg: "#f7f7f7",
			clusterBorder: "#999999",
			edgeLabelBackground: "#ffffff",
		},
		themeCSS: `
.node rect, .node circle, .node polygon, .node path { rx: 2; }
.edgeLabel { background-color: transparent; }
.edgePath .path, path.flowchart-link { stroke-width: 1px; }
`,
		// 正交布线交给 elk 原生能力（专业级通道路由、交叉最小化、箭头垂直进出），
		// 不做任何自定义几何加工；间距为排版留白
		diagramConfig: {
			layout: "elk",
			flowchart: { rankSpacing: 60, nodeSpacing: 55, padding: 10 },
		},
	},
};
