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
			.setName("渲染防抖")
			.setDesc("输入源码时延迟渲染的毫秒数")
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
			.setName("启用缩放/平移")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.zoomEnabled).onChange(async (v) => {
					this.plugin.settings.zoomEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("水平对齐")
			.setDesc("渲染结果在容器内的水平位置")
			.addDropdown((d) =>
				d
					.addOptions({ left: "左对齐", center: "居中", right: "右对齐" })
					.setValue(this.plugin.settings.imageAlign)
					.onChange(async (v) => {
						this.plugin.settings.imageAlign = v as BestMermaidSettings["imageAlign"];
						await this.plugin.saveSettings();
						this.plugin.onStyleChange();
					}),
			);

		new Setting(containerEl)
			.setName("布局引擎")
			.setDesc("elk 提供专业级正交布线与交叉最小化（体积较大，按需加载）")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "自动（跟随样式）", dagre: "dagre（默认）", elk: "elk（实验性）" })
					.setValue(this.plugin.settings.layoutEngine)
					.onChange(async (v) => {
						this.plugin.settings.layoutEngine = v as BestMermaidSettings["layoutEngine"];
						await this.plugin.saveSettings();
						this.plugin.onStyleChange();
					}),
			);
	}

	/** 样式画廊：卡片网格（色板 + 名称 + 说明 + 操作） */
	private renderStyleGallery(): void {
		const section = this.containerEl.createDiv({ cls: "bm-style-section" });
		new Setting(section).setName("样式").setDesc("全局默认样式，图内可用 %% bm-style: <id> %% 指令覆盖");

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
			title.createSpan({ cls: "bm-style-current", text: "当前" });
		}

		if (style.description) card.createDiv({ cls: "bm-style-desc", text: style.description });
		card.createDiv({
			cls: "bm-style-mode",
			text: style.mode === "dynamic" ? "跟随主题" : "固定配色",
		});

		const actions = card.createDiv({ cls: "bm-style-actions" });
		if (style.id !== this.plugin.settings.defaultStyleId) {
			actions.createEl("button", { text: "设为默认" }).addEventListener("click", async () => {
				this.plugin.settings.defaultStyleId = style.id;
				await this.plugin.saveSettings();
				this.plugin.onStyleChange();
				this.display();
			});
		}
		if (!this.plugin.registry.isBuiltin(style.id)) {
			actions.createEl("button", { text: "删除" }).addEventListener("click", () => {
				this.plugin.registry.deleteUser(style.id);
				this.display();
			});
		}
	}
}
