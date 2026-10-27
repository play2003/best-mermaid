import type { ThemeProfile } from "../types";
import { resolveLayout } from "./layout";

type MermaidApi = (typeof import("mermaid"))["default"];

/**
 * 渲染引擎：mermaid 的唯一调用点。
 * - 懒加载：首次渲染才 import("mermaid")（体积大，不能拖慢插件启动）
 * - 唯一渲染 id：规避 mermaid SVG 内部节点 id 冲突（已知坑，在此收口）
 * - 配置批次：mermaid.initialize 是全局可变状态——同配置的多张图**只 initialize
 *   一次并并发渲染**（打开文档的主要提速点）；配置变化时先等旧批清空再切换，
 *   保证任何时刻"全局配置 → 在飞渲染"的一致性
 */
export class RenderEngine {
	private mermaidPromise: Promise<MermaidApi> | null = null;
	private elkRegistered = false;
	private elkWarned = false;
	private counter = 0;

	/** 当前批次的配置签名（JSON 串）；null = 无有效批次 */
	private batchSig: string | null = null;
	/** 当前批次全部完成的 gate（下一个不同配置的批次等它） */
	private batchDone: Promise<void> = Promise.resolve();
	private batchRelease: (() => void) | null = null;
	private batchInflight = 0;
	/** 批次切换互斥：并发出现的不同配置排队切换，避免 initialize 交叉 */
	private switchLock: Promise<void> = Promise.resolve();

	constructor(
		private vaultId: string,
		private getLayoutEngine: () => string,
	) {}

	async render(source: string, theme: ThemeProfile, directive?: Record<string, unknown> | null): Promise<string> {
		const config = await this.buildConfig(theme, directive);
		const sig = JSON.stringify(config);

		if (sig !== this.batchSig) {
			await this.switchLock.then(async () => {
				await this.batchDone;
				// 双检：等待期间同签名的请求可能已建批
				if (sig !== this.batchSig) {
					const mermaid = await this.load();
					mermaid.initialize(config);
					this.batchSig = sig;
					this.batchInflight = 0;
					this.batchDone = new Promise<void>((resolve) => {
						this.batchRelease = resolve;
					});
				}
			});
		}

		this.batchInflight++;
		try {
			return await this.doRenderWithTimeout(source, config);
		} finally {
			if (--this.batchInflight === 0) this.batchRelease?.();
		}
	}

	/** 构建完整 mermaid 配置（initialize 的全部输入；批次签名即它的 JSON） */
	private async buildConfig(
		theme: ThemeProfile,
		directive?: Record<string, unknown> | null,
	): Promise<Record<string, unknown>> {
		const mermaid = await this.load();
		const config: Record<string, unknown> = {
			startOnLoad: false,
			securityLevel: "strict",
			// 纯 SVG 文本标签：mermaid 默认 htmlLabels 会产生 <foreignObject>，
			// Chromium 对含 foreignObject 的 SVG 图片光栅化会污染 canvas，
			// 导致导出 PNG 时 toBlob 抛安全异常。关闭后预览与导出同源、且 SVG 合法
			htmlLabels: false,
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
		return config;
	}

	/**
	 * 单图渲染超时保护：个别图在真实环境（Electron/字体/布局）可能让 mermaid.render
	 * 永不返回。超时转为失败 → 错误框可见化；批次由 finally 的计数自然放行。
	 */
	private doRenderWithTimeout(source: string, config: Record<string, unknown>): Promise<string> {
		const TIMEOUT = 15_000;
		let timer: number | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = window.setTimeout(
				() => reject(new Error(`Mermaid render timed out after ${TIMEOUT / 1000}s (diagram too complex or engine hung)`)),
				TIMEOUT,
			);
		});
		return Promise.race([this.doRender(source, config), timeout]).finally(() => {
			if (timer !== undefined) window.clearTimeout(timer);
		});
	}

	private async doRender(source: string, config: Record<string, unknown>): Promise<string> {
		const mermaid = await this.load();
		const id = this.nextRenderId();

		try {
			const { svg } = await mermaid.render(id, source);
			return svg;
		} catch (e) {
			// render 失败时 mermaid 可能留下临时 DOM（id 的元素），清理掉避免污染预览
			document.getElementById(id)?.remove();
			// elk 布局阶段失败（如个别图结构 elk 不支持）：本图降级 dagre 重试一次。
			// 配置被改变 → 批次作废（后续渲染重建批次），避免在飞渲染拿到混合配置
			if (config.layout === "elk") {
				this.batchSig = null;
				const fallbackId = this.nextRenderId();
				try {
					mermaid.initialize({ ...config, layout: "dagre", elk: {} });
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
