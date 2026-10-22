import type { ThemeProfile } from "../types";
import { resolveLayout } from "./layout";

type MermaidApi = (typeof import("mermaid"))["default"];

/**
 * 渲染引擎：mermaid 的唯一调用点。
 * - 懒加载：首次渲染才 import("mermaid")（体积 ~1MB+，不能拖慢插件启动）
 * - 唯一渲染 id：规避 mermaid SVG 内部节点 id 冲突（已知坑，必须在此收口）
 */
export class RenderEngine {
	private mermaidPromise: Promise<MermaidApi> | null = null;
	private elkRegistered = false;
	private elkWarned = false;
	private counter = 0;
	/**
	 * 渲染串行队列。mermaid.initialize 是全局可变状态，
	 * 并发渲染会互相覆盖配置（A 的主题色被 B 的冲掉），必须 initialize→render 整体串行。
	 */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private vaultId: string,
		private getLayoutEngine: () => string,
	) {}

	async render(source: string, theme: ThemeProfile, directive?: Record<string, unknown> | null): Promise<string> {
		const run = this.queue.then(() => this.doRender(source, theme, directive));
		this.queue = run.catch(() => {}); // 单图失败不阻断后续渲染
		return run;
	}

	private async doRender(
		source: string,
		theme: ThemeProfile,
		directive?: Record<string, unknown> | null,
	): Promise<string> {
		const mermaid = await this.load();
		const id = this.nextRenderId();

		const config: Record<string, unknown> = {
			startOnLoad: false,
			securityLevel: "strict",
			// 样式卡的布局基线（curve/间距等），优先级低于图内指令
			...theme.diagramConfig,
			theme: theme.baseTheme,
			themeVariables: { ...theme.themeVariables },
			themeCSS: theme.themeCSS,
		};

		// 布局引擎：elk 需要注册 loader（懒加载，~2MB 只在首次用到时执行）
		const { layout, elk } = resolveLayout(directive, theme, this.getLayoutEngine());
		// layout 每次显式写入：initialize 是合并语义，不写会让上次的 layout:'elk'
		// 残留在全局配置里，切回 dagre 的渲染会"静默继续用 elk"
		config.layout = layout;
		if (elk) {
			try {
				await this.ensureElk(mermaid);
				// ELK Layered 调优：NETWORK_SIMPLEX 节点摆放（层次对齐最好），
				// mergeEdges 关闭（合并长边虽省 bends 但破坏层次感）
				config.elk = { mergeEdges: false, nodePlacementStrategy: "NETWORK_SIMPLEX" };
			} catch (e) {
				// elk 不可用（加载失败/CSP 限制）：降级 dagre，警告一次
				config.layout = "dagre";
				config.elk = {};
				if (!this.elkWarned) {
					this.elkWarned = true;
					console.warn("[best-mermaid] elk layout engine unavailable, falling back to dagre:", e);
				}
			}
		}

		if (directive) this.applyDirective(config, directive);
		mermaid.initialize(config as Parameters<typeof mermaid.initialize>[0]);

		try {
			const { svg } = await mermaid.render(id, source);
			return svg;
		} catch (e) {
			// render 失败时 mermaid 可能留下临时 DOM（id 的元素），清理掉避免污染预览
			document.getElementById(id)?.remove();
			// elk 布局阶段失败（如个别图结构 elk 不支持）：降级 dagre 重试一次
			if (config.layout === "elk") {
				const fallbackId = this.nextRenderId();
				try {
					mermaid.initialize({ ...config, layout: "dagre", elk: {} } as Parameters<typeof mermaid.initialize>[0]);
					const { svg } = await mermaid.render(fallbackId, source);
					return svg;
				} catch (e2) {
					document.getElementById(fallbackId)?.remove();
					throw e2;
				}
			}
			throw e;
		}
	}

	/** 全局唯一渲染 id：vault 前缀 + 自增计数 */
	private nextRenderId(): string {
		return `bm-${this.vaultId}-${++this.counter}`;
	}

	/**
	 * 图内 %%{init}%% 指令覆盖全局配置（用户指令优先级最高）。
	 * themeVariables 做字段级合并；themeCSS 是追加语义——覆盖会把插件的主题适配样式整段丢掉。
	 */
	private applyDirective(config: Record<string, unknown>, directive: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(directive)) {
			if (key === "themeCSS" && typeof value === "string") {
				config.themeCSS = `${config.themeCSS ?? ""}\n${value}`;
			} else if (key === "themeVariables" && value && typeof value === "object" && !Array.isArray(value)) {
				config.themeVariables = {
					...(config.themeVariables as Record<string, string>),
					...(value as Record<string, string>),
				};
			} else {
				config[key] = value;
			}
		}
	}

	/** ELK 布局 loader 注册（幂等）：首次用到 elk 布局的图时才动态加载 */
	private async ensureElk(mermaid: MermaidApi): Promise<void> {
		if (this.elkRegistered) return;
		const elkLayouts = (await import("@mermaid-js/layout-elk")).default;
		mermaid.registerLayoutLoaders(elkLayouts);
		this.elkRegistered = true;
	}

	private load(): Promise<MermaidApi> {
		if (!this.mermaidPromise) {
			this.mermaidPromise = import("mermaid").then((m) => {
				m.default.initialize({ startOnLoad: false, securityLevel: "strict" });
				return m.default;
			});
		}
		return this.mermaidPromise;
	}
}
