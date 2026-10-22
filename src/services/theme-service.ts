/**
 * 主题服务：用 MutationObserver 监听 body 的主题 token 变化
 * （Obsidian 切换亮/暗时 body 的 theme-dark/theme-light class 会变），
 * 触发回调让插件失效缓存并重渲染当前可见图。
 *
 * 注意：只比较主题 token，不能比较整个 className——
 * Obsidian 在窗口失焦/聚焦时会加减 is-focused 等 class，
 * 全串比较会把每次窗口焦点切换都误判成主题切换，导致全部图闪烁重渲染。
 */
export class ThemeService {
	/** 影响配色解析的 body class token；其他 token（is-focused 等）与配色无关 */
	private static readonly THEME_RE = /(?:^|\s)(theme-(?:dark|light))(?=\s|$)/;

	private observer: MutationObserver | null = null;
	private lastThemeToken = "";

	/** @param onChange 主题变化回调（插件层负责失效缓存 + 重渲染） */
	constructor(private onChange: () => void) {}

	start(): void {
		if (this.observer) return;
		this.lastThemeToken = this.currentToken();
		this.observer = new MutationObserver(() => {
			const token = this.currentToken();
			if (token !== this.lastThemeToken) {
				this.lastThemeToken = token;
				this.onChange();
			}
		});
		this.observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	private currentToken(): string {
		return document.body.className.match(ThemeService.THEME_RE)?.[1] ?? "";
	}
}
