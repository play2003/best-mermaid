import type { StyleCard } from "./types";

/**
 * 样式注册表：内置卡（编译在代码里）+ 用户卡（持久化在 data.json）。
 * 注册表只管数据，解析逻辑在 ThemeResolver。
 */
export class StyleRegistry {
	private user = new Map<string, StyleCard>();

	constructor(
		private builtin: StyleCard[],
		private onChange?: () => void,
	) {}

	list(): StyleCard[] {
		return [...this.builtin, ...this.user.values()];
	}

	get(id: string): StyleCard | undefined {
		return this.builtin.find((s) => s.id === id) ?? this.user.get(id);
	}

	/** 未指定/指定样式不存在时的兜底：第一张内置卡（跟随主题） */
	getFallback(): StyleCard {
		return this.builtin[0];
	}

	isBuiltin(id: string): boolean {
		return this.builtin.some((s) => s.id === id);
	}

	loadUser(cards: StyleCard[]): void {
		for (const card of cards ?? []) {
			if (card?.id) this.user.set(card.id, card);
		}
	}

	exportUser(): StyleCard[] {
		return [...this.user.values()];
	}

	upsertUser(card: StyleCard): void {
		this.user.set(card.id, card);
		this.onChange?.();
	}

	deleteUser(id: string): void {
		if (this.user.delete(id)) this.onChange?.();
	}
}
