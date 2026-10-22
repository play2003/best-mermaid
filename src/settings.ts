import { App, PluginSettingTab, Setting } from "obsidian";
import type BestMermaidPlugin from "./main";
import type { StyleCard } from "./styles/types";

export interface BestMermaidSettings {
	/** 输入时渲染防抖（毫秒） */
	debounceMs: number;
	/** 启用容器内缩放/平移 */
	zoomEnabled: boolean;
	/** 渲染缓存上限（条） */
	cacheLimit: number;
	/** 出错时回退 Obsidian 内置渲染器（诊断用，改动后需重载插件） */
	fallbackToBuiltin: boolean;
	/** 全局默认样式 id（图上 bm-style 指令可覆盖） */
	defaultStyleId: string;
	/** 渲染结果在容器内的水平对齐 */
	imageAlign: "left" | "center" | "right";
	/** 布局引擎：auto=跟随样式卡；elk=专业正交布线（实验性） */
	layoutEngine: "auto" | "dagre" | "elk";
	/** 用户自定义样式卡（持久化） */
	userStyles: StyleCard[];
}

export const DEFAULT_SETTINGS: BestMermaidSettings = {
	debounceMs: 300,
	zoomEnabled: true,
	cacheLimit: 100,
	fallbackToBuiltin: false,
	defaultStyleId: "follow",
	imageAlign: "left",
	layoutEngine: "auto",
	userStyles: [],
};

export class BestMermaidSettingTab extends PluginSettingTab {
	private plugin: BestMermaidPlugin;

	constructor(app: App, plugin: BestMermaidPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderStyleGallery();

		new Setting(containerEl)
			.setName("Layout engine")
			.setDesc("elk provides professional orthogonal edge routing (loaded on demand)")
			.addDropdown((d) =>
				d
					.addOptions({
						auto: "Auto (follow style)",
						dagre: "dagre (default)",
						elk: "elk (experimental)",
					})
					.setValue(this.plugin.settings.layoutEngine)
					.onChange(async (v) => {
						this.plugin.settings.layoutEngine = v as BestMermaidSettings["layoutEngine"];
						await this.plugin.saveSettings();
						this.plugin.onStyleChange();
					}),
			);

		new Setting(containerEl)
			.setName("Horizontal alignment")
			.setDesc("Horizontal position of rendered diagrams")
			.addDropdown((d) =>
				d
					.addOptions({ left: "Left", center: "Center", right: "Right" })
					.setValue(this.plugin.settings.imageAlign)
					.onChange(async (v) => {
						this.plugin.settings.imageAlign = v as BestMermaidSettings["imageAlign"];
						await this.plugin.saveSettings();
						this.plugin.onStyleChange();
					}),
			);

		new Setting(containerEl)
			.setName("Render debounce")
			.setDesc("Delay in milliseconds before re-rendering while typing")
			.addText((t) =>
				t.setValue(String(this.plugin.settings.debounceMs)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 0) {
						this.plugin.settings.debounceMs = n;
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Enable zoom and pan")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.zoomEnabled).onChange(async (v) => {
					this.plugin.settings.zoomEnabled = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	/** 样式画廊：卡片网格（色板 + 名称 + 说明 + 操作） */
	private renderStyleGallery(): void {
		const section = this.containerEl.createDiv({ cls: "bm-style-section" });
		new Setting(section)
			.setName("Styles")
			.setDesc("Default style for diagrams. Override per diagram with %% bm-style: <id> %%");

		const grid = section.createDiv({ cls: "bm-style-grid" });
		for (const style of this.plugin.registry.list()) {
			this.renderStyleCard(grid, style);
		}
	}

	private renderStyleCard(grid: HTMLElement, style: StyleCard): void {
		const card = grid.createDiv({ cls: "bm-style-card" });
		if (style.id === this.plugin.settings.defaultStyleId) card.addClass("is-current");

		const swatches = card.createDiv({ cls: "bm-style-swatches" });
		if (style.swatches.length > 0) {
			for (const color of style.swatches) {
				swatches.createDiv({ cls: "bm-style-swatch" }).style.backgroundColor = color;
			}
		} else {
			// dynamic 卡无固定色板：渲染主题色渐变占位
			for (let i = 0; i < 4; i++) swatches.createDiv({ cls: "bm-style-swatch bm-swatch-dynamic" });
		}

		const title = card.createDiv({ cls: "bm-style-title" });
		title.createSpan({ text: style.name });
		if (style.id === this.plugin.settings.defaultStyleId) {
			title.createSpan({ cls: "bm-style-current", text: "Current" });
		}

		if (style.description) card.createDiv({ cls: "bm-style-desc", text: style.description });
		card.createDiv({
			cls: "bm-style-mode",
			text: style.mode === "dynamic" ? "Follows theme" : "Fixed palette",
		});

		const actions = card.createDiv({ cls: "bm-style-actions" });
		if (style.id !== this.plugin.settings.defaultStyleId) {
			actions.createEl("button", { text: "Set as default" }).addEventListener("click", async () => {
				this.plugin.settings.defaultStyleId = style.id;
				await this.plugin.saveSettings();
				this.plugin.onStyleChange();
				this.display();
			});
		}
		if (!this.plugin.registry.isBuiltin(style.id)) {
			actions.createEl("button", { text: "Delete" }).addEventListener("click", () => {
				this.plugin.registry.deleteUser(style.id);
				this.display();
			});
		}
	}
}
