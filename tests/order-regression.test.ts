import { describe, it, expect } from "vitest";
import { MERMAID_BLOCK_SORT_ORDER } from "../src/pipeline/processor";

/**
 * 回归：Obsidian 1.15 让内置 mermaid 渲染器变成"同步接管"。
 *
 * 1.15 的 app.js 把内置库从 /lib/mermaid.min.js 换成 /lib/pele.min.js，
 * 且库已加载时走 `if (R5.loaded) { e(); return }`——在同一个 post-processor
 * 调用里同步把 `<pre><code class="language-mermaid">` 换成 `<div class="mermaid">`。
 *
 * 内置处理器与插件同为 sortOrder 0，而 core 先注册，于是它先把节点拿走；
 * 插件的 createCodeBlockPostProcessor 随后 findAll("code.language-mermaid")
 * 返回空，整个 handler 不会被调用。用户看到的就是"插件装好了但不接管"。
 *
 * 下面用最小复现把这条时序钉死：只要 sortOrder 不严格小于 0，插件就扫不到目标。
 */

/** 模拟 1.15 内置处理器：同步把代码块换成 div.mermaid */
function coreMermaidHandler(root: HTMLElement): void {
	for (const code of Array.from(root.querySelectorAll("code.language-mermaid"))) {
		const pre = code.parentElement;
		if (!pre) continue;
		const div = document.createElement("div");
		div.className = "mermaid"; // 内置渲染器产物，不再带 language-mermaid
		pre.replaceWith(div);
	}
}

/** 模拟插件的 createCodeBlockPostProcessor：扫不到 code.language-mermaid 就什么都不做 */
function pluginHandler(root: HTMLElement, calls: { count: number }): void {
	if (root.querySelectorAll("code.language-mermaid").length === 0) return;
	calls.count++;
}

/** 按 Obsidian 的注册语义执行：先 push 后稳定排序 (sortOrder || 0) */
function runChain(pluginSortOrder: number): number {
	const root = document.createElement("div");
	root.innerHTML = '<pre><code class="language-mermaid">flowchart LR\nA-->B</code></pre>';

	const calls = { count: 0 };
	const registered: Array<{ fn: () => void; sortOrder: number | undefined }> = [
		{ fn: () => coreMermaidHandler(root), sortOrder: undefined }, // core 先注册，sortOrder 0
		{ fn: () => pluginHandler(root, calls), sortOrder: pluginSortOrder },
	];
	registered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
	for (const entry of registered) entry.fn();

	return calls.count;
}

describe("mermaid 代码块处理器排序（回归：1.15 内置渲染同步抢走代码块）", () => {
	it("sortOrder 为 0 时插件被内置处理器挤掉（这就是故障现象）", () => {
		expect(runChain(0)).toBe(0);
	});

	it("用 MERMAID_BLOCK_SORT_ORDER 注册时插件能拿到代码块", () => {
		expect(MERMAID_BLOCK_SORT_ORDER).toBeLessThan(0);
		expect(runChain(MERMAID_BLOCK_SORT_ORDER)).toBe(1);
	});
});
