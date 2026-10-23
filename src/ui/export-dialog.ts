import { App, Modal, Notice, Setting } from "obsidian";
import { t } from "../i18n";
import type { PngExportOptions } from "../types";
import type { ExportService } from "../services/export";

/**
 * PNG 导出对话框：文件名（可编辑）、图片质量（倍率）。
 * 确认后优先使用 Electron 原生保存对话框选择落盘位置（@electron/remote），
 * 写盘用 Node fs；环境不支持时退化为浏览器下载并提示默认位置。
 */
export class ExportDialog extends Modal {
	private filename: string;
	private scale: number;

	constructor(
		app: App,
		private svg: SVGSVGElement,
		private defaults: PngExportOptions,
		private exporter: ExportService,
	) {
		super(app);
		this.filename = defaults.filename ?? "mermaid";
		this.scale = defaults.scale ?? 2;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: t("exportTitle") });

		new Setting(contentEl).setName(t("fileName")).addText((txt) => {
			txt.setValue(this.filename).onChange((v) => {
				this.filename = v;
			});
			txt.inputEl.select();
		});

		new Setting(contentEl).setName(t("quality")).addDropdown((dd) =>
			dd
				.addOptions({ "1": "1x", "2": "2x", "3": "3x", "4": "4x" })
				.setValue(String(this.scale))
				.onChange((v) => {
					this.scale = Number(v);
				}),
		);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t("cancel")).onClick(() => this.close()))
			.addButton((b) => b.setButtonText(t("exportBtn")).setCta().onClick(() => void this.doExport(b.buttonEl)));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async doExport(btn: HTMLButtonElement): Promise<void> {
		btn.disabled = true;
		try {
			const blob = await this.exporter.renderPng(this.svg, {
				filename: this.filename,
				background: this.defaults.background,
				scale: this.scale,
			});
			const savedPath = await savePng(blob, this.filename);
			if (savedPath === null) {
				new Notice(t("exportCancelled"));
				return;
			}
			new Notice(`${t("exportedTo")} ${savedPath}`);
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error("[best-mermaid] PNG export failed:", e);
			new Notice(`${t("exportFailed")}: ${msg}`, 8000);
		} finally {
			btn.disabled = false;
		}
	}
}

/** 通过 Electron 原生保存对话框落盘；返回最终路径，取消返回 null，环境不支持时退化为下载 */
async function savePng(blob: Blob, filename: string): Promise<string | null> {
	const req = getNodeRequire();
	const safeName = sanitizeName(filename);
	let dialog: ElectronDialog | undefined;
	try {
		const remote = req?.("@electron/remote") as ElectronRemote | undefined;
		dialog = remote?.dialog;
	} catch {
		dialog = undefined;
	}

	if (dialog) {
		const result = await dialog.showSaveDialog({
			defaultPath: `${safeName}.png`,
			filters: [{ name: "PNG", extensions: ["png"] }],
		});
		if (result.canceled || !result.filePath) return null;
		const buffer = Buffer.from(await blob.arrayBuffer());
		const fs = req?.("fs") as NodeFs | undefined;
		if (!fs?.promises?.writeFile) throw new Error("Node fs unavailable");
		await fs.promises.writeFile(result.filePath, buffer);
		return result.filePath;
	}

	// 兜底：浏览器下载（无法选位置，进入系统默认下载目录）
	const a = createEl("a");
	a.href = URL.createObjectURL(blob);
	a.download = `${safeName}.png`;
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
	return `${t("downloadsFolder")}${safeName}.png`;
}

interface ElectronDialog {
	showSaveDialog(options: {
		defaultPath: string;
		filters: Array<{ name: string; extensions: string[] }>;
	}): Promise<{ canceled: boolean; filePath?: string }>;
}

interface ElectronRemote {
	dialog?: ElectronDialog;
}

interface NodeFs {
	promises?: {
		writeFile?: (path: string, data: Buffer) => Promise<void>;
	};
}

/** Obsidian 桌面端暴露的 CommonJS require；网页/测试环境没有则返回 null */
type NodeRequire = (module: string) => unknown;

function getNodeRequire(): NodeRequire | null {
	const req = (window as unknown as { require?: NodeRequire }).require;
	return typeof req === "function" ? req : null;
}

function sanitizeName(name: string): string {
	return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "mermaid";
}
