import { describe, it, expect } from "vitest";
import {
	applyTextEdits,
	extractTuneDirective,
	isFlowchartSource,
	locateFencedBlock,
	replaceBlockBody,
	rewriteEdgeLabel,
	rewriteNodeLabel,
	sanitizeLabelText,
	scanFlowchartSource,
	upsertTuneDirective,
} from "../src/services/tune-source";

const GRAPH = "flowchart LR\n    A[Start] -->|yes| B[End]";

describe("识别 flowchart", () => {
	it("flowchart / graph 均识别", () => {
		expect(isFlowchartSource("flowchart LR\n A-->B")).toBe(true);
		expect(isFlowchartSource("%%{init: {}}%%\ngraph TD\n A-->B")).toBe(true);
		expect(isFlowchartSource("sequenceDiagram\n A->>B: hi")).toBe(false);
	});
});

describe("bm-tune 指令读写", () => {
	it("提取并剥离全部指令行，最后一条胜出", () => {
		const src = '%% bm-tune: {"v":1,"nodes":{"A":{"x":1,"y":2,"w":100,"h":40}}} %%\nflowchart LR\n%% bm-tune: {"v":1,"nodes":{"B":{"x":9,"y":9,"w":50,"h":40}}} %%\nA-->B';
		const { raw, clean } = extractTuneDirective(src);
		expect(raw).toContain('"B"');
		expect(clean).not.toContain("bm-tune");
		expect(clean).toContain("flowchart LR");
	});

	it("upsert：插入到图声明前，重复调用只保留一行", () => {
		const tune = { v: 1 as const, nodes: { A: { x: 1, y: 2, w: 100, h: 40 } } };
		const once = upsertTuneDirective(GRAPH, tune);
		const twice = upsertTuneDirective(once, tune);
		expect(once.match(/bm-tune/g)).toHaveLength(1);
		expect(twice).toBe(once);
		expect(once.indexOf("bm-tune")).toBeLessThan(once.indexOf("flowchart"));
	});

	it("空数据移除指令", () => {
		const withTune = upsertTuneDirective(GRAPH, { v: 1, nodes: { A: { x: 1, y: 2, w: 100, h: 40 } } });
		expect(upsertTuneDirective(withTune, { v: 1, nodes: {}, edges: {} })).not.toContain("bm-tune");
	});

	it("保留 CRLF", () => {
		const src = "flowchart LR\r\nA-->B";
		const out = upsertTuneDirective(src, { v: 1, nodes: { A: { x: 1, y: 2, w: 100, h: 40 } } });
		expect(out).toContain("\r\n");
	});
});

describe("扫描与文字改写", () => {
	it("扫描链式边与节点定义", () => {
		const scan = scanFlowchartSource("flowchart LR\n A[Start] --> B --> C[End]");
		expect(scan.nodes.map((n) => n.id).sort()).toEqual(["A", "C"]);
		expect(scan.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["A>B", "B>C"]);
		expect(scan.headerLine).toBe(0);
	});

	it("改写节点标签：未加引号、带引号、特殊字符", () => {
		expect(rewriteNodeLabel(GRAPH, "A", "开始").source).toContain('A["开始"]');
		expect(rewriteNodeLabel('flowchart LR\n A["Old"] --> B', "A", "New").source).toContain('A["New"]');
		expect(rewriteNodeLabel("flowchart LR\n A[x(1)] --> B", "A", "y(2)").source).toContain('A["y(2)"]');
	});

	it("引号内的闭合字符不提前截断标签", () => {
		const src = 'flowchart LR\n A["a]b"] --> B';
		expect(rewriteNodeLabel(src, "A", "ok").source).toContain('A["ok"]');
	});

	it("同名节点多处定义全部同步", () => {
		const src = "flowchart LR\n A[One] --> B\n A[Two] --> C";
		const out = rewriteNodeLabel(src, "A", "Same").source;
		expect(out.match(/A\["Same"\]/g)).toHaveLength(2);
	});

	it("裸节点：图声明后补一行定义", () => {
		const out = rewriteNodeLabel("flowchart LR\n A --> B", "A", "Label").source;
		const lines = out.split("\n");
		expect(lines[1]).toContain('A["Label"]');
		expect(out).toContain("A --> B");
	});

	it("节点不存在时报错且不改源码", () => {
		const result = rewriteNodeLabel(GRAPH, "Z", "x");
		expect(result.error).toBe("node-not-found");
		expect(result.source).toBe(GRAPH);
	});

	it("改写 |label| 形式的边标签", () => {
		expect(rewriteEdgeLabel(GRAPH, "A", "B", "no").source).toContain("-->|no| B");
	});

	it("改写文字型箭头标签 -- text -->", () => {
		const src = "flowchart LR\n A -- yes --> B";
		expect(rewriteEdgeLabel(src, "A", "B", "no").source).toContain("-- no -->");
	});

	it("无标签的边插入标签，清空时移除", () => {
		const src = "flowchart LR\n A --> B";
		const added = rewriteEdgeLabel(src, "A", "B", "x").source;
		expect(added).toContain("-->|x| B");
		expect(rewriteEdgeLabel(added, "A", "B", "").source.trim()).toBe(src.trim());
	});

	it("同名边多条时拒绝改写", () => {
		const src = "flowchart LR\n A --> B\n A --> B";
		expect(rewriteEdgeLabel(src, "A", "B", "x").error).toBe("edge-ambiguous");
	});

	it("applyTextEdits 任一失败整体拒绝", () => {
		const result = applyTextEdits(GRAPH, [
			{ kind: "node", id: "A", text: "ok" },
			{ kind: "node", id: "Z", text: "bad" },
		]);
		expect(result.error).toBe("node-not-found");
		expect(result.source).toBe(GRAPH);
	});

	it("标签清洗：换行→<br/>，引号→#quot;，超长拒绝", () => {
		expect(sanitizeLabelText("a\nb").text).toBe("a<br/>b");
		expect(sanitizeLabelText('say "hi"').text).toBe("say #quot;hi#quot;");
		expect(sanitizeLabelText("x".repeat(501)).error).toBe("label-too-long");
	});
});

describe("笔记围栏块定位与替换", () => {
	const note = [
		"# 标题",
		"",
		"```mermaid",
		"flowchart LR",
		"  A --> B",
		"```",
		"",
		"正文",
		"```mermaid",
		"sequenceDiagram",
		"  A->>B: hi",
		"```",
	].join("\n");

	it("按内容唯一定位", () => {
		const loc = locateFencedBlock(note, { rawSource: "sequenceDiagram\n  A->>B: hi" });
		expect(loc).toEqual({ bodyStartLine: 9, bodyEndLine: 10, prefix: "" });
	});

	it("内容不匹配时返回 null", () => {
		expect(locateFencedBlock(note, { rawSource: "flowchart TD\nX-->Y" })).toBeNull();
	});

	it("相同内容多个块时用行号提示消歧", () => {
		const dup = "```mermaid\nA-->B\n```\n\ntext\n\n```mermaid\nA-->B\n```";
		expect(locateFencedBlock(dup, { rawSource: "A-->B" })).toBeNull();
		expect(locateFencedBlock(dup, { rawSource: "A-->B", lineStartHint: 6 })?.bodyStartLine).toBe(7);
	});

	it("只替换 fence 之间的内容", () => {
		const loc = locateFencedBlock(note, { rawSource: "flowchart LR\n  A --> B" })!;
		const next = note.replace("flowchart LR\n  A --> B", "flowchart LR\n  A --> C");
		const out = replaceBlockBody(note, loc, "flowchart LR\n  A --> C");
		expect(out).toBe(next);
		expect(out).toContain("# 标题");
		expect(out).toContain("sequenceDiagram");
	});

	it("支持 ~ 围栏与引用前缀", () => {
		const quoted = "> ~~~mermaid\n> A-->B\n> ~~~";
		const loc = locateFencedBlock(quoted, { rawSource: "A-->B" });
		expect(loc?.prefix).toBe("> ");
		const out = replaceBlockBody(quoted, loc!, "A-->C");
		expect(out).toBe("> ~~~mermaid\n> A-->C\n> ~~~");
	});
});
