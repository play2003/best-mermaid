import { describe, it, expect } from "vitest";
import { TunePersistence, TunePersistenceError } from "../src/services/tune-persistence";

const NOTE = [
	"# 标题",
	"",
	"```mermaid",
	"flowchart LR",
	"    A[Start] --> B[End]",
	"```",
	"",
	"其他内容",
].join("\n");

function makeApp(initial = NOTE) {
	let note = initial;
	const writes: string[] = [];
	const file = { path: "note.md", extension: "md" };
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => (path === "note.md" ? file : null),
			process: async (_file: unknown, fn: (data: string) => string) => {
				const next = fn(note);
				writes.push(next);
				note = next;
				return next;
			},
		},
	};
	return { app: app as never, writes, getNote: () => note };
}

const RAW = "flowchart LR\n    A[Start] --> B[End]";

describe("微调落盘（一次原子写）", () => {
	it("只改目标代码块内容，其余字节不动", async () => {
		const { app, writes, getNote } = makeApp();
		const persistence = new TunePersistence(app);
		const next = '%% bm-tune: {"v":1,"nodes":{"A":{"x":1,"y":2,"w":100,"h":40}}} %%\nflowchart LR\n    A["新"] --> B[End]';

		await persistence.save({ sourcePath: "note.md", rawSource: RAW, ctx: null, el: document.createElement("div") }, next);

		expect(writes).toHaveLength(1);
		const note = getNote();
		expect(note).toContain("# 标题");
		expect(note).toContain("其他内容");
		expect(note).toContain("bm-tune");
		expect(note).toContain('A["新"]');
		expect(note.match(/```/g)).toHaveLength(2);
	});

	it("内容已被并发修改时拒绝写入", async () => {
		const { app, writes } = makeApp(NOTE.replace("A[Start]", "A[Changed]"));
		const persistence = new TunePersistence(app);
		await expect(
			persistence.save({ sourcePath: "note.md", rawSource: RAW, ctx: null, el: document.createElement("div") }, RAW),
		).rejects.toMatchObject({ code: "block-not-found" });
		expect(writes).toHaveLength(0);
	});

	it("缺少 sourcePath / 文件不存在时给出明确错误", async () => {
		const { app } = makeApp();
		const persistence = new TunePersistence(app);
		await expect(
			persistence.save({ sourcePath: "", rawSource: RAW, ctx: null, el: document.createElement("div") }, RAW),
		).rejects.toMatchObject({ code: "no-source-path" });
		await expect(
			persistence.save({ sourcePath: "missing.md", rawSource: RAW, ctx: null, el: document.createElement("div") }, RAW),
		).rejects.toMatchObject({ code: "file-not-found" });
	});

	it("错误类型可被上层识别", () => {
		const error = new TunePersistenceError("block-ambiguous");
		expect(error).toBeInstanceOf(TunePersistenceError);
		expect(error.code).toBe("block-ambiguous");
	});
});
