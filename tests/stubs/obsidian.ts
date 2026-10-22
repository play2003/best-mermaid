/** 测试专用 obsidian 模块桩 */

export const moment = {
	locale: (): string => (globalThis as unknown as { __BM_LOCALE__?: string }).__BM_LOCALE__ ?? "en",
};

/** setIcon 桩：记录图标名到 dataset，便于断言 */
export function setIcon(el: HTMLElement, iconName: string): void {
	el.dataset.icon = iconName;
}
