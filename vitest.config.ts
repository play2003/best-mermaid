import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			// 测试中把 obsidian 模块指向桩（moment 可由用例控制）
			obsidian: resolve(__dirname, "tests/stubs/obsidian.ts"),
		},
	},
	test: {
		environment: "jsdom",
		environmentOptions: {
			jsdom: { pretendToBeVisual: true },
		},
		include: ["tests/**/*.test.ts"],
		setupFiles: ["tests/setup.ts"],
		testTimeout: 20000,
	},
});
