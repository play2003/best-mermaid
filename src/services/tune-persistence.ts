/**
 * 微调结果落盘：一次原子 vault.process，只替换目标 mermaid 代码块的内容。
 *
 * 定位优先级：
 * 1. 保存时重新取 ctx.getSectionInfo(el) 的行号作为提示
 * 2. 全文 fence 扫描，内容必须与 attach 时的源码一致（防并发改写）
 * 3. 仍无法唯一定位 → 抛错，绝不写错块
 */
import type { App, MarkdownPostProcessorContext, TFile } from "obsidian";
import { locateFencedBlock, replaceBlockBody } from "./tune-source";

export interface TuneSaveTarget {
	sourcePath: string;
	rawSource: string;
	ctx: MarkdownPostProcessorContext | null;
	el: HTMLElement;
}

export class TunePersistenceError extends Error {
	constructor(readonly code: TuneSaveErrorCode) {
		super(code);
		this.name = "TunePersistenceError";
	}
}

export type TuneSaveErrorCode = "no-source-path" | "file-not-found" | "block-not-found" | "block-ambiguous" | "write-failed";

export class TunePersistence {
	constructor(private app: App) {}

	async save(target: TuneSaveTarget, nextBlock: string): Promise<void> {
		if (!target.sourcePath) throw new TunePersistenceError("no-source-path");
		const file = this.app.vault.getAbstractFileByPath(target.sourcePath);
		if (!file || typeof (file as TFile).path !== "string") throw new TunePersistenceError("file-not-found");

		// 行号提示只在保存瞬间取（编辑器可能已改动内容，扫描仍会做内容校验）
		const sectionInfo = target.ctx?.getSectionInfo(target.el) ?? null;
		const lineStartHint = sectionInfo?.lineStart ?? null;

		try {
			await this.app.vault.process(file as TFile, (data) => {
				const loc = locateFencedBlock(data, { rawSource: target.rawSource, lineStartHint });
				if (!loc) throw new TunePersistenceError("block-not-found");
				return replaceBlockBody(data, loc, nextBlock);
			});
		} catch (error) {
			if (error instanceof TunePersistenceError) throw error;
			throw new TunePersistenceError("write-failed");
		}
	}
}
