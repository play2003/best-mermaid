/**
 * 主题服务：用 MutationObserver 监听 body class 变化
 * （Obsidian 切换主题/暗色模式时 body 的 theme-dark/theme-light class 会变），
 * 触发回调让插件失效缓存并重渲染当前可见图。
 */
export class ThemeService {
	private observer: MutationObserver | null = null;
	private lastBodyClass = "";

	/** @param onChange 主题变化回调（插件层负责失效缓存 + 重渲染） */
	constructor(private onChange: () => void) {}

	start(): void {
		if (this.observer) return;
		this.lastBodyClass = document.body.className;
		this.observer = new MutationObserver(() => {
			const cls = document.body.className;
			if (cls !== this.lastBodyClass) {
				this.lastBodyClass = cls;
				this.onChange();
			}
		});
		this.observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}
