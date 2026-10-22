/**
 * 渲染缓存：cacheKey → SVG 字符串，LRU 淘汰。
 * 缓存字符串而非 DOM，避免持有已卸载节点。
 */
export class RenderCache {
	private map = new Map<string, string>();

	constructor(private limit = 100) {}

	get(key: string): string | undefined {
		const svg = this.map.get(key);
		if (svg !== undefined) {
			// 命中即续期（Map 迭代序 = 插入序，删后重插即移到队尾）
			this.map.delete(key);
			this.map.set(key, svg);
		}
		return svg;
	}

	put(key: string, svg: string): void {
		this.map.delete(key);
		this.map.set(key, svg);
		while (this.map.size > this.limit) {
			const oldest = this.map.keys().next().value;
			if (oldest === undefined) break;
			this.map.delete(oldest);
		}
	}

	clear(): void {
		this.map.clear();
	}
}
