import { describe, it, expect, afterEach } from "vitest";
import { t, tStyle } from "../src/i18n";

const setLocale = (v?: string) => {
	(globalThis as unknown as { __BM_LOCALE__?: string }).__BM_LOCALE__ = v;
};

afterEach(() => setLocale(undefined));

describe("i18n 跟随 Obsidian 语言设置", () => {
	it("英文（默认）", () => {
		setLocale("en");
		expect(t("styles")).toBe("Styles");
		expect(t("renderFailed")).toBe("Mermaid render failed");
	});
	it("中文（zh/zh-cn）", () => {
		setLocale("zh");
		expect(t("styles")).toBe("样式");
		expect(t("current")).toBe("当前");
		setLocale("zh-cn");
		expect(t("setAsDefault")).toBe("设为默认");
	});
	it("未知 key 回退 key 本身", () => {
		setLocale("en");
		expect(t("__nope__")).toBe("__nope__");
	});
	it("导出按钮文案", () => {
		setLocale("en");
		expect(t("exportPng")).toBe("Export PNG");
		setLocale("zh-cn");
		expect(t("exportPng")).toBe("导出 PNG");
	});
	it("样式卡文案随语言切换", () => {
		const card = {
			name: "Paper",
			description: "Print style",
			translations: { zh: { name: "论文黑白", description: "印刷风格" } },
		};
		setLocale("en");
		expect(tStyle(card)).toEqual({ name: "Paper", description: "Print style" });
		setLocale("zh-cn");
		expect(tStyle(card)).toEqual({ name: "论文黑白", description: "印刷风格" });
		// 无该语言翻译时回退默认文案
		setLocale("zh");
		expect(tStyle({ name: "Custom", description: "x" }).name).toBe("Custom");
	});
});
