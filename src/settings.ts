import { App, PluginSettingTab, Setting } from "obsidian";
import type BestMermaidPlugin from "./main";
import type { StyleCard } from "./styles/types";
import { t, tStyle } from "./i18n";

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

		// 官方 UI 指南：常规设置置于最上方且不加标题；分区标题用 setHeading
		new Setting(containerEl)
			.setName(t("layoutEngine"))
			.setDesc(t("layoutEngineDesc"))
			.addDropdown((d) =>
				d
					.addOptions({
						auto: t("engineAuto"),
						dagre: t("engineDagre"),
						elk: t("engineElk"),
					})
					.setValue(this.plugin.settings.layoutEngine)
					.onChange(async (v) => {
						this.plugin.settings.layoutEngine = v as BestMermaidSettings["layoutEngine"];
						await this.plugin.saveSettings();
						this.plugin.onStyleChange();
					}),
			);

		new Setting(containerEl)
			.setName(t("horizontalAlignment"))
			.setDesc(t("horizontalAlignmentDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ left: t("alignLeft"), center: t("alignCenter"), right: t("alignRight") })
					.setValue(this.plugin.settings.imageAlign)
					.onChange(async (v) => {
						this.plugin.settings.imageAlign = v as BestMermaidSettings["imageAlign"];
						await this.plugin.saveSettings();
						this.plugin.onStyleChange();
					}),
			);

		new Setting(containerEl)
			.setName(t("renderDebounce"))
			.setDesc(t("renderDebounceDesc"))
			.addText((t2) =>
				t2.setValue(String(this.plugin.settings.debounceMs)).onChange(async (v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 0) {
						this.plugin.settings.debounceMs = n;
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName(t("enableZoom"))
			.addToggle((t2) =>
				t2.setValue(this.plugin.settings.zoomEnabled).onChange(async (v) => {
					this.plugin.settings.zoomEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		this.renderStyleGallery();
	}

	/** 样式画廊：卡片网格（色板 + 名称 + 说明 + 操作） */
	private renderStyleGallery(): void {
		const section = this.containerEl.createDiv({ cls: "bm-style-section" });
		new Setting(section).setName(t("styles")).setDesc(t("stylesDesc")).setHeading();

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

		const text = tStyle(style);
		const title = card.createDiv({ cls: "bm-style-title" });
		title.createSpan({ text: text.name });
		if (style.id === this.plugin.settings.defaultStyleId) {
			title.createSpan({ cls: "bm-style-current", text: t("current") });
		}

		if (text.description) card.createDiv({ cls: "bm-style-desc", text: text.description });
		card.createDiv({
			cls: "bm-style-mode",
			text: style.mode === "dynamic" ? t("followsTheme") : t("fixedPalette"),
		});

		const actions = card.createDiv({ cls: "bm-style-actions" });
		if (style.id !== this.plugin.settings.defaultStyleId) {
			actions.createEl("button", { text: t("setAsDefault") }).addEventListener("click", async () => {
				this.plugin.settings.defaultStyleId = style.id;
				await this.plugin.saveSettings();
				this.plugin.onStyleChange();
				this.display();
			});
		}
		if (!this.plugin.registry.isBuiltin(style.id)) {
			actions.createEl("button", { text: t("delete") }).addEventListener("click", () => {
				this.plugin.registry.deleteUser(style.id);
				this.display();
			});
		}
	}
}
