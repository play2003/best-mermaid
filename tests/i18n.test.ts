import { describe, it, expect, afterEach } from "vitest";
import { t } from "../src/i18n";

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
});
