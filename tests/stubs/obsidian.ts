/** 测试专用 obsidian 模块桩 */

export const moment = {
	locale: (): string => (globalThis as unknown as { __BM_LOCALE__?: string }).__BM_LOCALE__ ?? "en",
};

/** setIcon 桩：记录图标名到 dataset，便于断言 */
export function setIcon(el: HTMLElement, iconName: string): void {
	el.dataset.icon = iconName;
}

/** settings 测试桩：仅提供 settings.ts 运行时引用到的成员 */
export class App {}

export class PluginSettingTab {
	containerEl: HTMLElement = document.createElement("div");
	constructor(public app: unknown, public plugin: unknown) {}
	update(): void {}
}

export class Setting {
	settingEl: HTMLElement = document.createElement("div");
	nameEl: HTMLElement = document.createElement("div");
	descEl: HTMLElement = document.createElement("div");
	controlEl: HTMLElement = document.createElement("div");
	constructor(public containerEl?: HTMLElement) {
		this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
	}
	setName(_name: string | DocumentFragment): this {
		return this;
	}
	setDesc(_desc: string | DocumentFragment): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
}
