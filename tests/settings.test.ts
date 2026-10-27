import { describe, it, expect } from "vitest";
import { BestMermaidSettingTab, DEFAULT_SETTINGS } from "../src/settings";
import { StyleRegistry } from "../src/styles/registry";
import { follow } from "../src/styles/builtin/follow";
import { midnight } from "../src/styles/builtin/midnight";

function makeTab() {
	const plugin = {
		settings: { ...DEFAULT_SETTINGS, userStyles: [] },
		registry: new StyleRegistry([follow, midnight]),
		saveSettings: async () => {},
		onStyleChange: () => {},
	};
	const tab = new BestMermaidSettingTab({} as never, plugin as never);
	return { tab, plugin };
}

describe("样式画廊（声明式设置 render 行）", () => {
	it("render 定义存在且可执行", () => {
		const { tab } = makeTab();
		const defs = tab.getSettingDefinitions();
		const gallery = defs.find((d) => "render" in d);
		expect(gallery).toBeTruthy();
	});

	it("回归：update() 反复触发 render 时卡片不翻倍（4→8 bug）", () => {
		const { tab } = makeTab();
		const defs = tab.getSettingDefinitions();
		const gallery = defs.find((d) => "render" in d)!;
		const setting = { settingEl: document.createElement("div") } as never;

		// 模拟 Obsidian 多次 update() 重复调用 render
		(gallery as { render: (s: never) => void }).render(setting);
		(gallery as { render: (s: never) => void }).render(setting);
		(gallery as { render: (s: never) => void }).render(setting);

		const el = (setting as { settingEl: HTMLElement }).settingEl;
		expect(el.querySelectorAll(".bm-style-grid")).toHaveLength(1);
		expect(el.querySelectorAll(".bm-style-card")).toHaveLength(2);
	});
});
