import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
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
	/** 在控制台输出渲染耗时统计（性能诊断用） */
	perfLog: boolean;
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
	perfLog: false,
};

export class BestMermaidSettingTab extends PluginSettingTab {
	private plugin: BestMermaidPlugin;

	constructor(app: App, plugin: BestMermaidPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** 声明式设置（Obsidian 1.13+）：常规设置在顶部，样式画廊作为自定义渲染分区 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t("layoutEngine"),
				desc: t("layoutEngineDesc"),
				control: {
					type: "dropdown",
					key: "layoutEngine",
					defaultValue: "auto",
					options: {
						auto: t("engineAuto"),
						dagre: t("engineDagre"),
						elk: t("engineElk"),
					},
				},
			},
			{
				name: t("horizontalAlignment"),
				desc: t("horizontalAlignmentDesc"),
				control: {
					type: "dropdown",
					key: "imageAlign",
					defaultValue: "left",
					options: { left: t("alignLeft"), center: t("alignCenter"), right: t("alignRight") },
				},
			},
			{
				name: t("renderDebounce"),
				desc: t("renderDebounceDesc"),
				control: { type: "text", key: "debounceMs", defaultValue: String(DEFAULT_SETTINGS.debounceMs) },
			},
			{
				name: t("enableZoom"),
				control: { type: "toggle", key: "zoomEnabled", defaultValue: DEFAULT_SETTINGS.zoomEnabled },
			},
			// perfLog（性能日志）不在设置页展示：诊断用，需要时在插件 data.json 里手动加 "perfLog": true
			{
				name: t("styles"),
				desc: t("stylesDesc"),
				render: (setting) => {
					setting.settingEl.addClass("bm-style-setting");
					this.renderStyleGallery(setting.settingEl);
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === "debounceMs") return String(this.plugin.settings.debounceMs);
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const record = this.plugin.settings as unknown as Record<string, unknown>;
		record[key] = key === "debounceMs" ? Math.max(0, Number(value) || 0) : value;
		await this.plugin.saveSettings();
		if (key === "layoutEngine" || key === "imageAlign") this.plugin.onStyleChange();
	}

	/** 样式画廊：卡片网格（色板 + 名称 + 说明 + 操作）。
	 *  声明式 API 每次 update() 都会重新调用 render —— 先移除自己的旧网格再重建，避免翻倍。 */
	private renderStyleGallery(container: HTMLElement): void {
		container.querySelector(":scope > .bm-style-grid")?.remove();
		const grid = container.createDiv({ cls: "bm-style-grid" });
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
				swatches.createDiv({ cls: "bm-style-swatch" }).setCssStyles({ backgroundColor: color });
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
			actions.createEl("button", { text: t("setAsDefault") }).addEventListener("click", () => {
				void this.setDefaultStyle(style.id);
			});
		}
		if (!this.plugin.registry.isBuiltin(style.id)) {
			actions.createEl("button", { text: t("delete") }).addEventListener("click", () => {
				this.plugin.registry.deleteUser(style.id);
				this.update();
			});
		}
	}

	private async setDefaultStyle(styleId: string): Promise<void> {
		this.plugin.settings.defaultStyleId = styleId;
		await this.plugin.saveSettings();
		this.plugin.onStyleChange();
		this.update();
	}
}
