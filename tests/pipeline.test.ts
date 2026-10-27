import { describe, it, expect, vi } from "vitest";
import { MermaidBlockProcessor } from "../src/pipeline/processor";
import { SourceNormalizer } from "../src/pipeline/normalizer";
import { StyleRegistry } from "../src/styles/registry";
import { RenderCache } from "../src/services/cache";
import { follow } from "../src/styles/builtin/follow";
import { midnight } from "../src/styles/builtin/midnight";
import { resolveLayout } from "../src/pipeline/layout";
import { FakeExportDialog, GRAPH, makeDeps, sleep, waitFor } from "./pipeline.test-utils";
import { ThemeResolver } from "../src/pipeline/theme-resolver";

describe("管线集成（jsdom + 真实 mermaid 渲染）", () => {
	it("离屏分离树：connected=false 的容器也要渲染（回归：启动全灭）", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div"); // 故意不挂载，模拟 Obsidian 启动时的分离树

		processor.handle(GRAPH, el, {} as never);
		await sleep(300);

		expect(el.querySelector("svg")).toBeTruthy();
		expect(el.hasClass("best-mermaid-container")).toBe(true);
	});

	it("挂载克隆：rerenderAll 以 DOM 为准，能找到并重渲染克隆容器（回归：样式切换部分不更新）", async () => {
		const { deps, settings } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);

		// 模拟启动：分离树渲染 → Obsidian 克隆挂载 → 原节点成"尸体"
		const detached = document.createElement("div");
		processor.handle(GRAPH, detached, {} as never);
		await sleep(300);
		const attached = detached.cloneNode(true) as HTMLElement;
		document.body.appendChild(attached);

		// 切样式 → rerenderAll 应命中挂载的克隆节点并换装
		settings.defaultStyleId = "midnight";
		processor.rerenderAll();
		await sleep(600);

		expect(attached.querySelector("svg")).toBeTruthy();
		expect(attached.querySelector(".best-mermaid-wrap")).toBeTruthy();
	});

	it("样式切换改变渲染结果（themeVariables 进 SVG）", async () => {
		const { deps, settings } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle(GRAPH, el, {} as never);
		await sleep(300);
		const before = el.innerHTML;

		settings.defaultStyleId = "midnight";
		processor.rerenderAll();
		await sleep(600);
		const after = el.innerHTML;

		expect(after).not.toBe(before);
	});

	it("共享宿主：重渲染只清自己的节点，外部注入保留", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		const foreign = document.createElement("div");
		foreign.className = "other-plugin-btn";
		el.appendChild(foreign);

		processor.handle(GRAPH, el, {} as never);
		await sleep(300);

		expect(el.querySelector(".other-plugin-btn")).toBe(foreign); // 引用不变，节点幸存
		expect(el.querySelector(".best-mermaid-wrap")).toBeTruthy();
	});

	it("错误可视化：语法错误渲染错误框而非空白", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle("flowchart TB\n    A --> this is not valid syntax", el, {} as never);
		await sleep(300);

		expect(el.querySelector(".best-mermaid-error")).toBeTruthy();
	});

	it("懒加载区块：旧版本容器进入 DOM 后由 observer 自动补渲染", async () => {
		const { deps, settings } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		processor.startWatch();

		// 启动阶段：分离树渲染（版本 0），节点不在文档中
		const el = document.createElement("div");
		processor.handle(GRAPH, el, {} as never);
		await sleep(300);

		// 切样式：版本 +1；容器不在 DOM，rerenderAll 扫不到，保持旧版本
		settings.defaultStyleId = "midnight";
		processor.rerenderAll();
		await sleep(300);
		expect(el.dataset.bmVersion).toBe("0");

		// 模拟滚动触发懒加载：Obsidian 把缓存区块放回 DOM → observer 应补渲染
		document.body.appendChild(el);
		await sleep(600);

		expect(el.dataset.bmVersion).toBe("1");
		expect(el.querySelector(".best-mermaid-wrap")).toBeTruthy();
		processor.stopWatch();
	});

	it("elk 布局引擎：注册后可渲染（懒加载链路）", async () => {
		const { deps, settings } = makeDeps({ layoutEngine: "elk" });
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle("flowchart TB\n    A[Start] --> B[Left]\n    A --> C[Right]\n    B --> D[End]", el, {} as never);
		await sleep(3000);

		expect(el.querySelector("svg")).toBeTruthy();
		expect(el.querySelector(".best-mermaid-error")).toBeNull();
	});

	it("论文黑白样式：默认经 elk 正交布线渲染成功", async () => {
		const { deps } = makeDeps({ defaultStyleId: "paper" });
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle("flowchart TB\n    A[Start] --> B[Left]\n    A --> C[Right]\n    B --> D[End]\n    C --> D", el, {} as never);
		await sleep(3000);

		expect(el.querySelector("svg")).toBeTruthy();
		expect(el.querySelector(".best-mermaid-error")).toBeNull();
	});

	it("容器守卫：内置渲染器事后覆盖我方输出时立即夺回（回归：重开标签页变默认主题）", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle(GRAPH, el, {} as never);
		await sleep(300);
		expect(el.querySelector(".best-mermaid-wrap")).toBeTruthy();

		// 模拟内置渲染器后发制人：清掉我方节点，写入原生 SVG（无 wrap）
		for (const child of [...el.children]) child.remove();
		const builtin = document.createElement("div");
		builtin.className = "mermaid";
		builtin.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
		el.appendChild(builtin);
		await sleep(400);

		// 守卫应已触发重渲染，我方 wrap 恢复
		expect(el.querySelector(".best-mermaid-wrap")).toBeTruthy();
	});

	it("渲染产物不含 foreignObject（回归：canvas 污染导致 toBlob 导出失败）", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle("flowchart TB\n    A[开始<br/>第二行] --> B{判断}\n    B -->|是| C[结果]", el, {} as never);
		await sleep(300);

		expect(el.innerHTML).not.toContain("foreignObject");
	});

	it("导出按钮：预览区右下角、点击打开导出对话框（文件名/背景）", async () => {
		const fake = new FakeExportDialog();
		const { deps } = makeDeps({ defaultStyleId: "midnight" }, { openExportDialog: fake.open });
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle(GRAPH, el, { sourcePath: "Notes/架构 笔记.md" } as never);
		await sleep(300);

		const btn = el.querySelector<HTMLButtonElement>(".best-mermaid-export");
		expect(btn).toBeTruthy();
		// 按钮是容器的绝对定位子节点（不进入 wrap，零布局影响；位置由 JS 计算）
		expect(btn!.parentElement).toBe(el);
		expect(btn!.type).toBe("button");

		btn!.click();
		await sleep(0);

		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0].options).toMatchObject({
			filename: "架构 笔记-1",
			background: "#0f172a",
		});
		expect(fake.calls[0].svg.tagName.toLowerCase()).toBe("svg");
	});

	it("导出文件名：同笔记第二张图序号递增，重渲染后保持稳定且按钮唯一", async () => {
		const fake = new FakeExportDialog();
		const { deps, settings } = makeDeps({ defaultStyleId: "midnight" }, { openExportDialog: fake.open });
		const processor = new MermaidBlockProcessor(deps);

		const el1 = document.createElement("div");
		const el2 = document.createElement("div");
		document.body.append(el1, el2);
		processor.handle(GRAPH, el1, { sourcePath: "Notes/a.md" } as never);
		processor.handle(GRAPH, el2, { sourcePath: "Notes/a.md" } as never);
		await sleep(300);

		el1.querySelector<HTMLButtonElement>(".best-mermaid-export")!.click();
		el2.querySelector<HTMLButtonElement>(".best-mermaid-export")!.click();
		await sleep(0);
		expect(fake.calls.map((c) => c.options?.filename)).toEqual(["a-1", "a-2"]);

		// 重渲染：按钮唯一且编号不变（轮询等待新按钮就位，避免负载下误判）
		settings.defaultStyleId = "paper";
		processor.rerenderAll();
		await waitFor(() => el1.querySelector(".best-mermaid-export") !== null);
		expect(el1.querySelectorAll(".best-mermaid-export")).toHaveLength(1);
		el1.querySelector<HTMLButtonElement>(".best-mermaid-export")!.click();
		await sleep(0);
		expect(fake.calls.at(-1)?.options?.filename).toBe("a-1");
	});

	it("同配置多图复用主题画像（探针解析只跑一次）", async () => {
		let calls = 0;
		const real = new ThemeResolver();
		const spy = {
			resolve: (style: Parameters<ThemeResolver["resolve"]>[0]) => {
				calls++;
				return real.resolve(style);
			},
		};
		const { deps } = makeDeps({}, { themeResolver: spy as ThemeResolver });
		const processor = new MermaidBlockProcessor(deps);

		const el1 = document.createElement("div");
		const el2 = document.createElement("div");
		document.body.append(el1, el2);
		processor.handle(GRAPH, el1, {} as never);
		processor.handle(GRAPH, el2, {} as never);
		await waitFor(() => el1.querySelector("svg") !== null && el2.querySelector("svg") !== null, 5000);

		expect(calls).toBe(1);
	});

	it("perfLog 开启时输出批次耗时汇总（默认关闭不输出）", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const { deps, settings } = makeDeps({ perfLog: false });
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle(GRAPH, el, {} as never);
		await sleep(900); // 批次静默窗口 600ms
		expect(info).not.toHaveBeenCalled();

		settings.perfLog = true;
		const el2 = document.createElement("div");
		document.body.appendChild(el2);
		processor.handle(GRAPH, el2, {} as never);
		await sleep(900);
		expect(info).toHaveBeenCalledTimes(1);
		expect(info.mock.calls[0][0]).toContain("1 diagrams in");
		info.mockRestore();
	});

	it("混合配置并发渲染：批次切换后三张图全部成功", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const els = [0, 1, 2].map(() => {
			const el = document.createElement("div");
			document.body.appendChild(el);
			return el;
		});

		// 图2 带 init 指令（配置不同），三张同时提交
		processor.handle(GRAPH, els[0], {} as never);
		processor.handle("flowchart LR\n    X --> Y", els[1], {} as never);
		processor.handle('%%{init: {"themeVariables": {"primaryColor": "#ff0000"}}}%%\nflowchart LR\n    P --> Q', els[2], {} as never);
		await waitFor(
			() => els.every((el) => el.querySelector("svg") !== null),
			8000,
		);

		for (const el of els) {
			expect(el.querySelector(".best-mermaid-error")).toBeNull();
		}
	});

	it("首次渲染跳过打字防抖（阅读视图打开提速）", async () => {
		const { deps } = makeDeps({ debounceMs: 300 });
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		const t0 = Date.now();
		processor.handle(GRAPH, el, {} as never);
		await waitFor(() => el.querySelector("svg") !== null, 3000);
		// 未等待 300ms 防抖即完成首次渲染
		expect(Date.now() - t0).toBeLessThan(300);
	});

	it("bm-style 图级指令覆盖全局默认样式", async () => {
		const { deps } = makeDeps();
		const processor = new MermaidBlockProcessor(deps);
		const el = document.createElement("div");
		document.body.appendChild(el);

		processor.handle("%% bm-style: midnight %%\n" + GRAPH, el, {} as never);
		await sleep(300);

		// 午夜蓝的暗色背景变量应出现在 SVG 内联样式中
		expect(el.innerHTML).toContain("#0f172a");
	});
});

describe("单元：resolveLayout 布局决策", () => {
	const theme = { diagramConfig: { layout: "elk" } } as never;
	it("优先级：图内指令 > 样式卡 > 设置", () => {
		expect(resolveLayout({ layout: "dagre" }, theme, "elk").layout).toBe("dagre");
		expect(resolveLayout(null, theme, "auto").layout).toBe("elk");
		expect(resolveLayout(null, { diagramConfig: {} } as never, "auto").layout).toBe("dagre");
		expect(resolveLayout(null, { diagramConfig: {} } as never, "elk").layout).toBe("elk");
	});
	it("auto 跟随样式卡，elk 判定正确", () => {
		expect(resolveLayout(null, theme, "auto").elk).toBe(true);
		expect(resolveLayout(null, { diagramConfig: {} } as never, "auto").elk).toBe(false);
	});
});

describe("单元：SourceNormalizer", () => {
	const n = () => new SourceNormalizer("11", "0.1.0");

	it("提取并剥离 %%{init}%%（嵌套 brace）", () => {
		const r = n().normalize("%%{init: {'themeVariables': {'primaryColor': '#ffd54f'}}}%%\nflowchart LR\n A --> B");
		expect(r.source).not.toContain("%%{init");
		expect(r.source).toContain("flowchart LR");
		expect(r.directive).toEqual({ themeVariables: { primaryColor: "#ffd54f" } });
	});

	it("无指令时 directive 为 null", () => {
		const r = n().normalize("flowchart LR\n A --> B");
		expect(r.directive).toBeNull();
	});

	it("提取并剥离 bm-style 指令", () => {
		const r = n().normalize("%% bm-style: midnight %%\nflowchart LR\n A --> B");
		expect(r.styleId).toBe("midnight");
		expect(r.source).not.toContain("bm-style");
	});

	it("未闭合的 init 指令保留原文（交 mermaid 报错）", () => {
		const src = "%%{init: {'theme': 'base'}\nflowchart LR";
		const r = n().normalize(src);
		expect(r.source).toBe(src.trim());
	});

	it("cacheKey：源码/指令/画像/布局任一变化键不同，同输入键稳定", () => {
		const n1 = n();
		const a = n1.cacheKey({ source: "A", directive: null, styleId: null }, "p1", "dagre");
		const b = n1.cacheKey({ source: "B", directive: null, styleId: null }, "p1", "dagre");
		const a2 = n1.cacheKey({ source: "A", directive: null, styleId: null }, "p1", "dagre");
		const c = n1.cacheKey({ source: "A", directive: null, styleId: null }, "p2", "dagre");
		const e = n1.cacheKey({ source: "A", directive: null, styleId: null }, "p1", "elk");
		expect(a).not.toBe(b);
		expect(a).toBe(a2);
		expect(a).not.toBe(c);
		expect(a).not.toBe(e);
	});
});

describe("单元：StyleRegistry", () => {
	it("内置卡查询与兜底", () => {
		const r = new StyleRegistry([follow, midnight]);
		expect(r.get("midnight")?.name).toBe("Midnight");
		expect(r.isBuiltin("midnight")).toBe(true);
		expect(r.isBuiltin("nope")).toBe(false);
		expect(r.getFallback().id).toBe("follow");
		expect(r.get("nope")).toBeUndefined();
	});

	it("用户卡增删改与变更回调", () => {
		let changed = 0;
		const r = new StyleRegistry([follow], () => changed++);
		const card = { ...follow, id: "mine", name: "我的样式" };
		r.upsertUser(card);
		expect(r.get("mine")).toBeTruthy();
		expect(r.isBuiltin("mine")).toBe(false);
		expect(r.exportUser()).toHaveLength(1);
		expect(changed).toBe(1);
		r.deleteUser("mine");
		expect(r.get("mine")).toBeUndefined();
		expect(changed).toBe(2);
	});
});

describe("单元：RenderCache（LRU）", () => {
	it("命中、淘汰、清空", () => {
		const c = new RenderCache(2);
		c.put("a", "1");
		c.put("b", "2");
		c.put("c", "3"); // a 被淘汰
		expect(c.get("a")).toBeUndefined();
		expect(c.get("b")).toBe("2");
		expect(c.get("c")).toBe("3");
		c.put("b", "2b"); // 命中续期
		c.put("d", "4"); // c 被淘汰
		expect(c.get("c")).toBeUndefined();
		expect(c.get("b")).toBe("2b");
		c.clear();
		expect(c.get("b")).toBeUndefined();
	});
});
