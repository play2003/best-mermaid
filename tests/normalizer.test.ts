import { describe, it, expect } from "vitest";
import { SourceNormalizer } from "../src/pipeline/normalizer";

const GRAPH = "flowchart LR\n    A[Start] --> B[End]";
const TUNE = '%% bm-tune: {"v":1,"nodes":{"A":{"x":100,"y":50,"w":160,"h":60}}} %%';

describe("bm-tune 指令（微调数据）", () => {
	it("从渲染源码中剥离，识别为 tune 数据", () => {
		const normalizer = new SourceNormalizer("11", "1.0.0");
		const normalized = normalizer.normalize(`${TUNE}\n${GRAPH}`);
		expect(normalized.source).toBe(GRAPH);
		expect(normalized.tuneError).toBeNull();
		expect(normalized.tune?.nodes?.A).toEqual({ x: 100, y: 50, w: 160, h: 60 });
	});

	it("无效 JSON 只标记 syntax，不抛错、不阻断渲染", () => {
		const normalizer = new SourceNormalizer("11", "1.0.0");
		const normalized = normalizer.normalize(`%% bm-tune: {oops %%\n${GRAPH}`);
		expect(normalized.tune).toBeNull();
		expect(normalized.tuneError).toBe("syntax");
		expect(normalized.source).toBe(GRAPH);
	});

	it("几何微调不参与缓存键（纯覆盖，不改变 mermaid 输出）", () => {
		const normalizer = new SourceNormalizer("11", "1.0.0");
		const plain = normalizer.normalize(GRAPH);
		const tuned = normalizer.normalize(`${TUNE}\n${GRAPH}`);
		expect(normalizer.cacheKey(tuned, "t", "dagre")).toBe(normalizer.cacheKey(plain, "t", "dagre"));
	});

	it("文字修改改变源码 → 缓存键变化", () => {
		const normalizer = new SourceNormalizer("11", "1.0.0");
		const a = normalizer.normalize(GRAPH);
		const b = normalizer.normalize(GRAPH.replace("Start", "Begin"));
		expect(normalizer.cacheKey(a, "t", "dagre")).not.toBe(normalizer.cacheKey(b, "t", "dagre"));
	});
});
