import { describe, it, expect, vi } from "vitest";
import { ThemeService } from "../src/services/theme-service";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const setBodyClass = (cls: string) => {
	document.body.className = cls;
};

describe("ThemeService", () => {
	it("窗口焦点切换（is-focused）不触发重渲染（回归：切回 Obsidian 全图闪烁）", async () => {
		setBodyClass("theme-dark");
		const onChange = vi.fn();
		const service = new ThemeService(onChange);
		service.start();

		setBodyClass("theme-dark is-focused"); // 切回 Obsidian
		await sleep(30);
		setBodyClass("theme-dark"); // 切走
		await sleep(30);
		expect(onChange).not.toHaveBeenCalled();

		service.stop();
	});

	it("亮暗主题切换触发一次", async () => {
		setBodyClass("theme-dark");
		const onChange = vi.fn();
		const service = new ThemeService(onChange);
		service.start();

		setBodyClass("theme-light");
		await sleep(30);
		expect(onChange).toHaveBeenCalledTimes(1);

		// 主题不变、附带无关 class：不触发
		setBodyClass("theme-light is-focused");
		await sleep(30);
		expect(onChange).toHaveBeenCalledTimes(1);

		// 再次真切换：触发
		setBodyClass("theme-dark is-focused");
		await sleep(30);
		expect(onChange).toHaveBeenCalledTimes(2);

		service.stop();
	});

	it("stop 后不再监听", async () => {
		setBodyClass("theme-dark");
		const onChange = vi.fn();
		const service = new ThemeService(onChange);
		service.start();
		service.stop();

		setBodyClass("theme-light");
		await sleep(30);
		expect(onChange).not.toHaveBeenCalled();
	});
});
