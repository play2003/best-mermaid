import type { ThemeProfile } from "../types";

/**
 * 布局决策：图内 %%{init}%% 指令 > 样式卡布局基线 > 全局设置。
 * settings.layoutEngine 的 "auto" 表示跟随样式卡（无则 dagre）。
 * 处理器与引擎各自调用本函数，保证两边对同一张图的决策一致。
 */
export function resolveLayout(
	directive: Record<string, unknown> | null | undefined,
	theme: ThemeProfile,
	fallback: string,
): { layout: string; elk: boolean } {
	const layout = String(
		(directive?.layout as string) ?? theme.diagramConfig?.layout ?? (fallback === "auto" ? "dagre" : fallback),
	);
	return { layout, elk: layout === "elk" };
}
