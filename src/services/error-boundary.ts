/**
 * 错误边界：渲染失败时绝不静默空白，
 * 渲染出带错误信息与源码定位的可视错误块。
 */
export class ErrorBoundary {
	render(el: HTMLElement, error: unknown, source: string): void {
		const msg = error instanceof Error ? error.message : String(error);
		const suspectLine = this.suspectLine(msg);

		const box = el.createDiv({ cls: "best-mermaid-error" });
		box.createDiv({
			cls: "bm-error-msg",
			text: `Mermaid render failed${suspectLine ? ` (near line ${suspectLine})` : ""}`,
		});
		box.createDiv({ cls: "bm-error-detail", text: msg });
		if (suspectLine !== null) {
			const lines = source.split("\n");
			const pre = box.createEl("pre");
			pre.setText(lines[suspectLine - 1] ?? "");
		}
	}

	/** 从 mermaid 的报错文本中提取疑似行号，提取不到返回 null */
	private suspectLine(msg: string): number | null {
		const m = /line[: ]+(\d+)/i.exec(msg);
		if (!m) return null;
		const n = Number(m[1]);
		return Number.isInteger(n) && n > 0 ? n : null;
	}
}
