import { Plugin } from "obsidian";
import { BestMermaidSettingTab, DEFAULT_SETTINGS, type BestMermaidSettings } from "./settings";
import type { PipelineDeps } from "./types";
import { MermaidBlockProcessor } from "./pipeline/processor";
import { SourceNormalizer } from "./pipeline/normalizer";
import { ThemeResolver } from "./pipeline/theme-resolver";
import { RenderEngine } from "./pipeline/engine";
import { PostProcessor } from "./pipeline/post-processor";
import { RenderCache } from "./services/cache";
import { ThemeService } from "./services/theme-service";
import { ErrorBoundary } from "./services/error-boundary";
import { InteractionService } from "./services/interaction";
import { ExportService } from "./services/export";
import { ExportDialog } from "./ui/export-dialog";
import { StyleRegistry } from "./styles/registry";
import { follow } from "./styles/builtin/follow";
import { midnight } from "./styles/builtin/midnight";
import { paper } from "./styles/builtin/paper";
import { terra } from "./styles/builtin/terra";

export default class BestMermaidPlugin extends Plugin {
	settings!: BestMermaidSettings;
	registry!: StyleRegistry;

	private themeService!: ThemeService;
	private processor!: MermaidBlockProcessor;
	private cache!: RenderCache;

	async onload() {
		await this.loadSettings();

		// 装配：样式注册表（内置卡在编译期固定，用户卡来自 data.json）
		this.registry = new StyleRegistry([follow, midnight, paper, terra], () => this.persistUserStyles());
		this.registry.loadUser(this.settings.userStyles);

		// 装配：服务层
		this.cache = new RenderCache(this.settings.cacheLimit);
		this.themeService = new ThemeService(() => this.onThemeChange());
		const exporter = new ExportService();
		// 装配：管线层（依赖注入，pipeline 不感知 services）
		const deps: PipelineDeps = {
			getSettings: () => this.settings,
			registry: this.registry,
			cache: this.cache,
			themeResolver: new ThemeResolver((cleanup) => this.register(cleanup)),
			engine: new RenderEngine(this.manifest.id, () => this.settings.layoutEngine),
			normalizer: new SourceNormalizer("11", this.manifest.version),
			postProcessor: new PostProcessor(),
			errorBoundary: new ErrorBoundary(),
			interaction: new InteractionService(() => this.settings.zoomEnabled),
			openExportDialog: (svg, defaults) => new ExportDialog(this.app, svg, defaults, exporter).open(),
		};
		this.processor = new MermaidBlockProcessor(deps);
		this.processor.startWatch();

		// 接管 ```mermaid 代码块渲染
		this.registerMarkdownCodeBlockProcessor("mermaid", this.processor.handle);
		this.themeService.start();
		this.addSettingTab(new BestMermaidSettingTab(this.app, this));

		// TODO(M3)：导出命令（需先选中图，暂缓）
	}

	onunload() {
		this.themeService.stop();
		this.processor.stopWatch();
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<BestMermaidSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** 用户样式卡变更 → 持久化 */
	private persistUserStyles() {
		this.settings.userStyles = this.registry.exportUser();
		void this.saveSettings();
	}

	/** 主题/样式变化：缓存全量失效 + 重渲染 */
	onThemeChange() {
		this.cache.clear();
		this.processor.rerenderAll();
	}

	/** 样式切换（设置页"设为默认"） */
	onStyleChange() {
		this.onThemeChange();
	}
}
