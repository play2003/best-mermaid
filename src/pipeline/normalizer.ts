import type { NormalizedSource } from "../types";

/**
 * 源码预处理器：
 * 1. 提取并剥离图内 %%{init:...}%% 前置指令（剥离后交给引擎合并进 initialize，
 *    不留在源码里，避免 mermaid 原生处理绕过我们的合并优先级）
 * 2. 提取并剥离样式选择指令 %% bm-style: <id> %%（纯注释，mermaid 原生忽略，
 *    选择随源码走：复制图/同步笔记不丢）
 * 3. 剔除影响缓存的噪声（首尾空白）
 * 4. 缓存键 = hash(源码 + 指令 + 样式 + 主题画像 + 版本)，由 cacheKey() 单独生成
 */
export class SourceNormalizer {
	constructor(
		private mermaidVersion: string,
		private pluginVersion: string,
	) {}

	normalize(source: string): NormalizedSource {
		const { clean, directive } = this.extractInit(source);
		const { clean: clean2, styleId } = this.extractBmStyle(clean);

		return {
			source: clean2.trim(),
			directive,
			styleId,
		};
	}

	/** 缓存键：需要在样式/主题画像/布局引擎都确定后调用 */
	cacheKey(n: NormalizedSource, themeProfileId: string, layout: string): string {
		return this.hash(
			`${n.source} ${n.directive ? JSON.stringify(n.directive) : ""} ${n.styleId ?? ""} ${themeProfileId} ${layout} ${this.mermaidVersion} ${this.pluginVersion}`,
		);
	}

	/** 提取全部 %%{init:...}%% 指令（brace 配对扫描，支持跨行），从源码中剥离 */
	private extractInit(source: string): { clean: string; directive: Record<string, unknown> | null } {
		const KEY = "%%{init:";
		let clean = source;
		let directive: Record<string, unknown> | null = null;

		let idx = clean.indexOf(KEY);
		while (idx !== -1) {
			// KEY 的 "{init:" 自带包裹层开括号 "{"（位于 idx+2），内部 JSON 从 KEY 之后开始，深度从 1 起算
			let depth = 1;
			let closeBrace = -1;
			for (let i = idx + KEY.length; i < clean.length; i++) {
				if (clean[i] === "{") depth++;
				else if (clean[i] === "}" && --depth === 0) {
					closeBrace = i;
					break;
				}
			}
			// 结尾必须是 "%%"，否则视为未闭合，保留原文交给 mermaid 自行报错
			if (closeBrace === -1 || clean.slice(closeBrace + 1, closeBrace + 3) !== "%%") break;

			const parsed = this.parseDirective(clean.slice(idx + KEY.length, closeBrace));
			if (parsed) directive = { ...(directive ?? {}), ...parsed }; // 多指令后者覆盖前者
			clean = clean.slice(0, idx) + clean.slice(closeBrace + 3);
			idx = clean.indexOf(KEY);
		}

		return { clean, directive };
	}

	/** 样式选择指令：%% bm-style: <id> %%（允许多条，后者覆盖前者） */
	private extractBmStyle(source: string): { clean: string; styleId: string | null } {
		const re = /%%\s*bm-style:\s*([A-Za-z0-9_-]+)\s*%%/g;
		let styleId: string | null = null;
		const clean = source.replace(re, (_m, id: string) => {
			styleId = id;
			return "";
		});
		return { clean, styleId };
	}

	/** 指令体是 JSON 或单引号风格，解析失败返回 null（原样留在源码，行为退回 mermaid 原生） */
	private parseDirective(raw: string): Record<string, unknown> | null {
		const attempt = (t: string): unknown => {
			try {
				return JSON.parse(t);
			} catch {
				return null;
			}
		};
		const v = attempt(raw) ?? attempt(raw.replace(/'/g, '"'));
		if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
		return null;
	}

	/** FNV-1a 32 位哈希，足够做缓存键 */
	private hash(input: string): string {
		let h = 0x811c9dc5;
		for (let i = 0; i < input.length; i++) {
			h ^= input.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(16);
	}
}
