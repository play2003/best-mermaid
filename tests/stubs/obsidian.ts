/** 测试专用 obsidian 模块桩：仅提供 i18n 用到的 moment */
export const moment = {
	locale: (): string => (globalThis as unknown as { __BM_LOCALE__?: string }).__BM_LOCALE__ ?? "en",
};
