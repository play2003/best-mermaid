import type { StyleCard } from "../types";

/**
 * 靛夜（static）：石板夜色 + 靛蓝点睛的现代深色风。
 * 心理锚点：秩序感、专业信任——面向投影/截图/汇报场景：
 * linear 直线传达精确，加大的层距保证远距离可读，
 * 箭头用与描边同色的靛蓝（全图唯一亮色，视线自动落在结构走向上）。
 */
export const midnight: StyleCard = {
	id: "midnight",
	name: "Midnight",
	description: "Dark presentation look: precise straight lines and an indigo accent, made for slides and screenshots",
	translations: {
		zh: { name: "靛夜", description: "深色展示风：直线精确、靛蓝点睛，适合投影与截图" },
	},
	swatches: ["#0f172a", "#1e293b", "#818cf8", "#e2e8f0"],
	mode: "static",
	config: {
		themeVariables: {
			background: "#0f172a",
			primaryColor: "#1e293b",
			primaryTextColor: "#e2e8f0",
			primaryBorderColor: "#818cf8",
			textColor: "#cbd5e1",
			secondaryTextColor: "#94a3b8",
			lineColor: "#475569",
			arrowheadColor: "#818cf8",
			fontSize: "15px",
			clusterBkg: "#141f38",
			clusterBorder: "#334155",
			edgeLabelBackground: "#0f172a",
		},
		themeCSS: `
.node rect, .node circle, .node polygon, .node path { rx: 8; }
.node .label { font-weight: 500; }
.edgeLabel { background-color: transparent; }
.edgePath .path, path.flowchart-link { stroke-width: 1.5px; }
`,
		diagramConfig: {
			flowchart: { curve: "linear", rankSpacing: 70, nodeSpacing: 55, padding: 12 },
		},
	},
};
