import type { ThemeProfile } from "../types";
import type { StyleCard } from "../styles/types";

/**
 * 主题解析器：样式卡 → 可渲染主题画像。
 *
 * - dynamic 卡：token 经探针元素解析为 Obsidian 当前主题的真实颜色（跟随亮暗）
 * - static 卡：值原样透传
 *
 * 注意：CSS 变量的原始值可能带 calc()（如 Obsidian 的强调色是
 * "hsl(calc(258 - 1), calc(88% * 1.01), ...)"），mermaid 解析不了。
 * 必须用探针元素让浏览器计算出最终的 rgb() 再交给 mermaid。
 */
const TOKEN_MAP: Record<string, string> = {
	"@accent": "--interactive-accent",
	"@bg": "--background-primary",
	"@text": "--text-normal",
	"@text-muted": "--text-muted",
	"@border": "--background-modifier-border",
	"@link": "--text-accent",
};

export class ThemeResolver {
	/** 颜色探针：把任意 CSS 变量解析成浏览器计算后的 rgb() 字符串 */
	private probeEl: HTMLSpanElement | null = null;

	/** @param cleanupRegistry 插件卸载时注册探针清理逻辑 */
	constructor(private cleanupRegistry?: (cleanup: () => void) => void) {}

	resolve(style: StyleCard): ThemeProfile {
		const dark = document.body.classList.contains("theme-dark");
		const vars: Record<string, string> = {};

		for (const [key, value] of Object.entries(style.config.themeVariables)) {
			vars[key] = style.mode === "dynamic" ? this.resolveToken(value, dark) : value;
		}
		vars.fontFamily ??= getComputedStyle(document.body).fontFamily || "inherit";
		vars.fontSize ??= "14px";

		return {
			id: this.profileId(style.id, dark, vars),
			// mermaid 官方约束：themeVariables 定制只对 base 主题完整生效，
			// default/dark 主题调色板有硬编码成分会忽略变量（实测 primaryColor 无效）
			baseTheme: "base",
			themeVariables: vars,
			themeCSS: style.config.themeCSS,
			diagramConfig: style.config.diagramConfig,
		};
	}

	/** 画像标识：参与缓存键，样式/亮暗/任何解析出的颜色变化都应改变 id */
	private profileId(styleId: string, dark: boolean, vars: Record<string, string>): string {
		return `${styleId}@${dark ? "d" : "l"}@${Object.entries(vars)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join(";")}`;
	}

	/** token → 真实颜色；未知 token 原样透传（允许与 hex 混用） */
	private resolveToken(token: string, dark: boolean): string {
		const t = token.trim();
		if (t === "@accent-fade") {
			// 节点填充色：强调色淡化（亮色向白混、暗色向黑混），避免与文字对比不足
			const accent = this.resolveColor("--interactive-accent");
			return accent ? this.fade(accent, dark ? 0.25 : 0.85) : "#888888";
		}
		const varName = TOKEN_MAP[t];
		if (varName) return this.resolveColor(varName) ?? "#888888";
		return token;
	}

	/** 通过探针元素把 CSS 变量解析为计算后的 "rgb(r, g, b)"，解析失败返回 null */
	private resolveColor(varName: string): string | null {
		if (!this.probeEl) {
			this.probeEl = createSpan();
			this.probeEl.setCssStyles({ display: "none" });
			document.body.appendChild(this.probeEl);
			this.cleanupRegistry?.(() => {
				this.probeEl?.remove();
				this.probeEl = null;
			});
		}
		this.probeEl.setCssStyles({ color: `var(${varName})` });
		const computed = getComputedStyle(this.probeEl).color;
		// 变量不存在或非法时 color 会回退为继承值，这里只认 rgb/rgba 形式
		return /^rgba?\(/.test(computed) ? computed : null;
	}

	/** rgb 颜色与白/黑混合做淡化 */
	private fade(color: string, keepRatio: number): string {
		const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
		if (!m) return color;
		const target = keepRatio > 0.5 ? 255 : 0;
		const mix = (c: number) => Math.round(c * keepRatio + target * (1 - keepRatio));
		return `rgb(${mix(Number(m[1]))}, ${mix(Number(m[2]))}, ${mix(Number(m[3]))})`;
	}
}
