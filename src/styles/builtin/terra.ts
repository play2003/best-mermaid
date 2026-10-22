import type { StyleCard } from "../types";

/**
 * 赤陶（static）：暖调人文风。
 * 心理锚点：温暖、低防御、亲和——面向教学/分享/协作场景：
 * 大圆角与柔和曲线（bouba 效应：圆润=友好安全），2px 线宽表达热情与自信，
 * 宽松间距降低认知负荷（讲解时听众更容易跟随分组），箭头用赭石强调方向感。
 */
export const terra: StyleCard = {
	id: "terra",
	name: "Terracotta",
	description: "Warm humanist palette: large radii, soft curves and generous spacing, great for teaching and sharing",
	translations: {
		zh: { name: "赤陶", description: "暖调人文风：大圆角、柔和曲线、宽松间距，适合讲解与分享" },
	},
	swatches: ["#faf5ec", "#f3e3c8", "#c2703d", "#3d2c1e"],
	mode: "static",
	config: {
		themeVariables: {
			background: "#faf5ec",
			primaryColor: "#f3e3c8",
			primaryTextColor: "#3d2c1e",
			primaryBorderColor: "#c2703d",
			textColor: "#4a3b2a",
			secondaryTextColor: "#8a7a66",
			lineColor: "#a89880",
			arrowheadColor: "#c2703d",
			fontSize: "15px",
			clusterBkg: "#f4ecdb",
			clusterBorder: "#d8c9ae",
			edgeLabelBackground: "#faf5ec",
		},
		themeCSS: `
.node rect, .node circle, .node polygon, .node path { rx: 14; }
.node .label { font-weight: 500; }
.edgeLabel { background-color: transparent; }
.edgePath .path, path.flowchart-link { stroke-width: 2px; }
`,
		diagramConfig: {
			flowchart: { curve: "basis", rankSpacing: 75, nodeSpacing: 65, padding: 14 },
		},
	},
};
