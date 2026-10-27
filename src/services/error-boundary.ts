/**
 * 错误边界：渲染失败时绝不静默空白。
 * 把 mermaid 的开发者向报错翻译成"哪里错 / 为什么 / 怎么修"的结构化诊断，
 * 原始错误折叠在 details 里备查。
 */
import { t } from "../i18n";

export interface ErrorDiagnosis {
	/** 出错行号（从报错文本提取），无则 null */
	line: number | null;
	/** 报错中携带的出错源码片段 */
	fragment: string | null;
	/** 人类可读原因的 i18n key（可识别时） */
	reasonKey: string | null;
	/** 修正后的整行建议（可生成时） */
	suggestion: string | null;
}

/** 从 mermaid 报错文本 + 源码中提取结构化诊断 */
export function diagnoseParseError(msg: string, source: string): ErrorDiagnosis {
	const lineMatch = /Parse error on line (\d+)/.exec(msg);
	const line = lineMatch ? Number(lineMatch[1]) : null;

	const fragMatch = /Parse error on line \d+:\s*\.\.\.([\s\S]*?)\s*-{5,}\^/.exec(msg);
	const fragment = fragMatch ? fragMatch[1].trim() : null;

	let reasonKey: string | null = null;
	let suggestion: string | null = null;

	if (/got 'PS'/.test(msg) || /got 'PSE'/.test(msg)) {
		reasonKey = "unquotedParens";
		const lineText = line ? (source.split("\n")[line - 1] ?? fragment) : fragment;
		if (lineText) suggestion = quoteLabels(lineText);
	}

	return { line, fragment, reasonKey, suggestion };
}

/**
 * 生成修复建议：把行内含括号/花括号等形状字符的 [标签] 用引号包裹。
 * 例：`J --> K[configure(surface)]` → `J --> K["configure(surface)"]`
 */
export function quoteLabels(line: string): string {
	return line.replace(
		/([\w-]+)(\[[^\[\]"`]*[(){}][^\[\]"`]*\])/g,
		(_m, id: string, label: string) => `${id}["${label.slice(1, -1)}"]`,
	);
}

export class ErrorBoundary {
	render(el: HTMLElement, error: unknown, source: string): void {
		const msg = error instanceof Error ? error.message : String(error);
		const d = diagnoseParseError(msg, source);

		const box = el.createDiv({ cls: "best-mermaid-error" });

		const title = box.createDiv({ cls: "bm-error-title" });
		title.textContent = d.line
			? t("errorTitleTemplate").replace("{n}", String(d.line))
			: t("errorTitle");

		if (d.reasonKey) {
			box.createDiv({ cls: "bm-error-reason", text: t(d.reasonKey) });
		}

		if (d.suggestion) {
			const sug = box.createDiv({ cls: "bm-error-suggestion" });
			sug.createSpan({ cls: "bm-error-suggestion-label", text: t("errorSuggestion") });
			sug.createEl("code", { text: d.suggestion.trim() });
		} else if (d.line) {
			// 没有可生成的建议时，至少把出错行单独示出
			const lineText = source.split("\n")[d.line - 1];
			if (lineText) box.createDiv({ cls: "bm-error-line", text: lineText.trim() });
		}

		const details = box.createEl("details", { cls: "bm-error-details" });
		details.createEl("summary", { text: t("errorDetails") });
		details.createEl("pre", { text: msg });
	}
}
