import { describe, it, expect } from "vitest";
import { diagnoseParseError, quoteLabels } from "../src/services/error-boundary";

const REAL_ERROR_1 = `Parse error on line 13:
... J --> K[configure(surface)] K -->
-----------------------^
Expecting 'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', 'SUBROUTINEEND', 'PIPE', 'CYLINDEREND', 'DIAMOND_STOP', 'TAGEND', 'TRAPEND', 'INVTRAPEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'PS'`;

const REAL_ERROR_2 = `Parse error on line 11:
...<br/>FixedThreadPool(4)] end su
-----------------------^
Expecting 'SQE', ... got 'PS'`;

describe("diagnoseParseError 结构化诊断", () => {
	it("提取行号/片段/原因/修复建议（真实报错样例 1）", () => {
		const d = diagnoseParseError(REAL_ERROR_1, "graph TD\n    J --> K[configure(surface)]");
		expect(d.line).toBe(13);
		expect(d.reasonKey).toBe("unquotedParens");
		expect(d.suggestion).toContain('K["configure(surface)"]');
	});

	it("真实报错样例 2：含中文与 <br/> 的标签（源码还原到真实行号）", () => {
		const lines = ["graph TB", ...Array<string>(9).fill("    subgraph 解码线程池"), "    DecPool[解码线程池<br/>FixedThreadPool(4)]"];
		const d = diagnoseParseError(REAL_ERROR_2, lines.join("\n"));
		expect(d.line).toBe(11);
		expect(d.reasonKey).toBe("unquotedParens");
		expect(d.suggestion).toContain('DecPool["解码线程池<br/>FixedThreadPool(4)"]');
	});

	it("非括号类错误：无建议，保留行号", () => {
		const d = diagnoseParseError("Parse error on line 2:\n...foo----^", "a\nb\n");
		expect(d.line).toBe(2);
		expect(d.reasonKey).toBeNull();
		expect(d.suggestion).toBeNull();
	});
});

describe("quoteLabels 引号修复生成", () => {
	it("包裹含括号的标签，已加引号的不动", () => {
		expect(quoteLabels('J --> K[configure(surface)]')).toBe('J --> K["configure(surface)"]');
		expect(quoteLabels('A["ok(1)"] --> B[x(2)]')).toBe('A["ok(1)"] --> B["x(2)"]');
	});
	it("同一行多个标签全部包裹", () => {
		expect(quoteLabels("A[p(1)] --> B[q(2)]")).toBe('A["p(1)"] --> B["q(2)"]');
	});
});
