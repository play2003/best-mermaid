/**
 * 微调覆盖层（纯 DOM/几何，不依赖 Obsidian）：
 * mermaid 语法无法表达逐节点尺寸与逐边走向，这些编辑以 bm-tune 数据保存，
 * 每次渲染后重放到新 SVG 上。
 *
 * 坐标一律使用根 svg 的 viewBox 用户坐标，与 CSS 尺寸/缩放/导出倍率解耦。
 */
import type { AnchorSide, BmTuneData, EdgeTune, NodeTune, TuneError } from "../types";

/** 数据上限：防止异常数据拖垮渲染 */
export const MAX_NODES = 500;
export const MAX_EDGES = 500;
export const MAX_POINTS = 200;
/** 节点最小尺寸（用户坐标） */
const MIN_W = 40;
const MIN_H = 24;
/** 锚点沿边内缩，避免贴在拐角 */
const SIDE_INSET = 4;

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	cx: number;
	cy: number;
	w: number;
	h: number;
}

export interface EdgeRef {
	from?: string;
	to?: string;
}

/** 解析并校验 %% bm-tune %% 指令体；失败时返回原因供 UI 提示 */
export function parseTune(raw: string): { tune: BmTuneData | null; error: TuneError } {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { tune: null, error: "syntax" };
	}
	return validateTune(value);
}

export function validateTune(value: unknown): { tune: BmTuneData | null; error: TuneError } {
	if (!isPlainObject(value)) return { tune: null, error: "syntax" };
	const version = (value as { v?: unknown }).v;
	if (version !== 1) {
		// 更新版本写入的数据：不破坏、不渲染覆盖（保存时应拒绝覆盖）
		return { tune: null, error: typeof version === "number" && version > 1 ? "version" : "syntax" };
	}

	const nodes: Record<string, NodeTune> = {};
	const edges: Record<string, EdgeTune> = {};

	const rawNodes = (value as { nodes?: unknown }).nodes;
	if (isPlainObject(rawNodes)) {
		for (const [id, candidate] of Object.entries(rawNodes).slice(0, MAX_NODES)) {
			const node = toNodeTune(candidate);
			if (node) nodes[id] = node;
		}
	}

	const rawEdges = (value as { edges?: unknown }).edges;
	if (isPlainObject(rawEdges)) {
		for (const [id, candidate] of Object.entries(rawEdges).slice(0, MAX_EDGES)) {
			const edge = toEdgeTune(candidate);
			if (edge) edges[id] = edge;
		}
	}

	if (Object.keys(nodes).length === 0 && Object.keys(edges).length === 0) {
		return { tune: null, error: null };
	}
	return { tune: { v: 1, nodes, edges }, error: null };
}

/** 序列化：key 排序、数值 0.1 精度、% 转义（避免提前闭合 %% 指令） */
export function serializeTune(tune: BmTuneData): string {
	const nodes: Record<string, NodeTune> = {};
	for (const id of Object.keys(tune.nodes ?? {}).sort()) {
		const n = tune.nodes![id];
		nodes[id] = { x: round1(n.x), y: round1(n.y), w: round1(n.w), h: round1(n.h) };
	}
	const edges: Record<string, EdgeTune> = {};
	for (const id of Object.keys(tune.edges ?? {}).sort()) {
		const e = tune.edges![id];
		const next: EdgeTune = {};
		if (e.from) next.from = e.from;
		if (e.to) next.to = e.to;
		if (e.src) next.src = e.src;
		if (e.dst) next.dst = e.dst;
		if (e.pts?.length) next.pts = e.pts.map(([x, y]) => [round1(x), round1(y)]);
		edges[id] = next;
	}
	return JSON.stringify({ v: 1, nodes, edges }).replace(/%/g, "\\u0025");
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function toNodeTune(value: unknown): NodeTune | null {
	if (!isPlainObject(value)) return null;
	const { x, y, w, h } = value as Record<string, unknown>;
	if (![x, y, w, h].every(isFiniteNumber)) return null;
	const width = Math.max(MIN_W, w as number);
	const height = Math.max(MIN_H, h as number);
	return { x: x as number, y: y as number, w: width, h: height };
}

function toEdgeTune(value: unknown): EdgeTune | null {
	if (!isPlainObject(value)) return null;
	const raw = value as Record<string, unknown>;
	const edge: EdgeTune = {};
	if (typeof raw.from === "string") edge.from = raw.from;
	if (typeof raw.to === "string") edge.to = raw.to;
	if (isSide(raw.src)) edge.src = raw.src;
	if (isSide(raw.dst)) edge.dst = raw.dst;
	if (Array.isArray(raw.pts)) {
		const pts: Array<[number, number]> = [];
		for (const p of raw.pts.slice(0, MAX_POINTS)) {
			if (!Array.isArray(p) || p.length < 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1])) continue;
			pts.push([p[0], p[1]]);
		}
		if (pts.length >= 2) edge.pts = pts;
	}
	if (!edge.from && !edge.to && !edge.src && !edge.dst && !edge.pts) return null;
	return edge;
}

function isSide(value: unknown): value is AnchorSide {
	return value === "l" || value === "r" || value === "t" || value === "b";
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 节点 key：优先 data-id，回退从 id="flowchart-A-0" 解析（mermaid 版本差异兜底） */
export function nodeKey(group: Element): string | null {
	const dataId = group.getAttribute("data-id");
	if (dataId) return dataId;
	const id = group.getAttribute("id") ?? "";
	// mermaid 11 的 id 带渲染前缀（bm-<vault>-<n>-flowchart-A-0），按后缀解析
	const match = /flowchart-(.+?)-\d+$/.exec(id);
	return match ? match[1] : null;
}

/** 连线 key：mermaid 11 的边 path 带 data-id（如 L_A_B_0） */
export function edgeKey(pathEl: Element): string | null {
	return pathEl.getAttribute("data-id");
}

/** 从默认边 id（L_A_B_0）推断起止节点；id 含下划线时可能歧义，调用方可传源码扫描结果优先 */
export function edgeRefFromId(id: string): EdgeRef | null {
	const match = /^L_([^_]+)_([^_]+)_\d+$/.exec(id);
	return match ? { from: match[1], to: match[2] } : null;
}

/**
 * 把覆盖数据应用到新渲染的 SVG。
 * 返回实际应用的节点数/边数与告警（未知 key 不算错误，源码可能刚被编辑）。
 */
export function applyTuneOverlay(
	svg: SVGSVGElement,
	tune: BmTuneData | null,
	edgeIndex: Record<string, EdgeRef> = {},
): { nodes: number; edges: number; warnings: string[] } {
	const result = { nodes: 0, edges: 0, warnings: [] as string[] };
	if (!tune) return result;

	// 幂等：同一份数据在同一 svg 上只应用一次（渲染管线每次都是新 svg，防重复调用叠加）
	const stamp = serializeTune(tune);
	if (svg.dataset.bmTuneApplied === stamp) return result;
	svg.dataset.bmTuneApplied = stamp;

	const nodeGroups = Array.from(svg.querySelectorAll("g.node"));
	const boxes = new Map<string, Box>();
	for (const group of nodeGroups) {
		const key = nodeKey(group);
		const box = measureNodeBox(group);
		if (key && box) boxes.set(key, box);
	}

	for (const [id, node] of Object.entries(tune.nodes ?? {})) {
		const group = nodeGroups.find((g) => nodeKey(g) === id);
		if (!group) {
			result.warnings.push(`node ${id} not found`);
			continue;
		}
		resizeNode(group, node);
		boxes.set(id, { cx: node.x, cy: node.y, w: node.w, h: node.h });
		result.nodes++;
	}

	const paths = Array.from(svg.querySelectorAll("path[data-id], path[id]"));
	for (const pathEl of paths) {
		const id = edgeKey(pathEl);
		if (!id) continue;
		const tuneEdge = tune.edges?.[id];
		const ref = tuneEdge?.from && tuneEdge?.to ? { from: tuneEdge.from, to: tuneEdge.to } : edgeIndex[id] ?? edgeRefFromId(id);
		if (!ref?.from || !ref.to) continue;

		const srcBox = boxes.get(ref.from);
		const dstBox = boxes.get(ref.to);
		const dirty =
			Boolean(tuneEdge?.pts) ||
			Boolean(tuneEdge?.src || tuneEdge?.dst) ||
			Boolean(tune.nodes?.[ref.from]) ||
			Boolean(tune.nodes?.[ref.to]);
		if (!dirty) continue;

		const points = tuneEdge?.pts ? tuneEdge.pts.map(([x, y]) => ({ x, y })) : decodePoints(pathEl);
		if (!points || points.length < 2) continue;

		if (tuneEdge?.pts) {
			// 已保存的点集：端点沿节点边滑动回边界（节点缩放后仍保持连接，不脱离）
			if (srcBox && tuneEdge.src) points[0] = anchorOnSide(srcBox, tuneEdge.src, points[0]);
			if (dstBox && tuneEdge.dst) points[points.length - 1] = anchorOnSide(dstBox, tuneEdge.dst, points[points.length - 1]);
		} else {
			if (srcBox) reanchorEnd(points, 0, srcBox, tuneEdge?.src);
			if (dstBox) reanchorEnd(points, points.length - 1, dstBox, tuneEdge?.dst);
		}
		setPathPoints(pathEl, points);
		result.edges++;
	}

	return result;
}

export function measureNodeBox(group: Element): Box | null {
	const shape = findShapeElement(group);
	if (!shape) return null;
	const translate = parseTranslate(group.getAttribute("transform"));
	const local = shapeBoxWithOwnTransform(shape);
	if (!local) return null;
	return {
		cx: translate.x + local.cx,
		cy: translate.y + local.cy,
		w: local.w,
		h: local.h,
	};
}

/** 形状自身可能带缩放（非矩形节点的通用回退），测量时需要把它算进去 */
function shapeBoxWithOwnTransform(shape: Element): Box | null {
	const local = localShapeBox(shape);
	if (!local) return null;
	const transform = shape.getAttribute("transform");
	if (!transform) return local;
	const scale = /scale\(\s*([-\d.]+)(?:[,\s]+([-\d.]+))?\s*\)/.exec(transform);
	if (!scale) return local;
	const sx = Number(scale[1]);
	const sy = scale[2] === undefined ? sx : Number(scale[2]);
	if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return local;
	return { cx: local.cx, cy: local.cy, w: local.w * sx, h: local.h * sy };
}

function findShapeElement(group: Element): Element | null {
	for (const child of Array.from(group.children)) {
		if (child.tagName === "g") continue; // label 等分组
		return child;
	}
	return null;
}

function localShapeBox(shape: Element): Box | null {
	const tag = shape.tagName;
	if (tag === "rect") {
		const x = num(shape.getAttribute("x"));
		const y = num(shape.getAttribute("y"));
		const w = num(shape.getAttribute("width"));
		const h = num(shape.getAttribute("height"));
		if (x === null || y === null || !w || !h) return null;
		return { cx: x + w / 2, cy: y + h / 2, w, h };
	}
	if (tag === "circle") {
		const cx = num(shape.getAttribute("cx")) ?? 0;
		const cy = num(shape.getAttribute("cy")) ?? 0;
		const r = num(shape.getAttribute("r")) ?? 0;
		return r > 0 ? { cx, cy, w: r * 2, h: r * 2 } : null;
	}
	if (tag === "ellipse") {
		const cx = num(shape.getAttribute("cx")) ?? 0;
		const cy = num(shape.getAttribute("cy")) ?? 0;
		const rx = num(shape.getAttribute("rx")) ?? 0;
		const ry = num(shape.getAttribute("ry")) ?? 0;
		return rx > 0 && ry > 0 ? { cx, cy, w: rx * 2, h: ry * 2 } : null;
	}
	const graphics = shape as SVGGraphicsElement;
	if (typeof graphics.getBBox === "function") {
		try {
			const bbox = graphics.getBBox();
			if (bbox.width > 0 && bbox.height > 0) {
				return { cx: bbox.x + bbox.width / 2, cy: bbox.y + bbox.height / 2, w: bbox.width, h: bbox.height };
			}
		} catch {
			// 分离 DOM 上 getBBox 可能抛错，交给调用方跳过
		}
	}
	return null;
}

/** 改写节点组：组 transform 定位中心，形状按中心缩放（mermaid rect 以本地 0,0 为中心） */
export function resizeNode(group: Element, node: NodeTune): void {
	const w = Math.max(MIN_W, node.w);
	const h = Math.max(MIN_H, node.h);
	// 保持 mermaid 的 translate(cx,cy)：后续标签居中依赖本地 0,0
	group.setAttribute("transform", `translate(${node.x}, ${node.y})`);

	const shapeEl = findShapeElement(group);
	if (!shapeEl) return;
	const tag = shapeEl.tagName;
	if (tag === "rect") {
		shapeEl.setAttribute("x", String(-w / 2));
		shapeEl.setAttribute("y", String(-h / 2));
		shapeEl.setAttribute("width", String(w));
		shapeEl.setAttribute("height", String(h));
		return;
	}
	if (tag === "circle") {
		shapeEl.setAttribute("cx", "0");
		shapeEl.setAttribute("cy", "0");
		shapeEl.setAttribute("r", String(Math.min(w, h) / 2));
		return;
	}
	if (tag === "ellipse") {
		shapeEl.setAttribute("cx", "0");
		shapeEl.setAttribute("cy", "0");
		shapeEl.setAttribute("rx", String(w / 2));
		shapeEl.setAttribute("ry", String(h / 2));
		return;
	}
	// 其余形状（polygon/path）：以组内原点为中心等比缩放，加 non-scaling-stroke 保线宽
	const local = localShapeBox(shapeEl);
	if (!local) return;
	const sx = w / local.w;
	const sy = h / local.h;
	shapeEl.setAttribute(
		"transform",
		`translate(${-local.cx}, ${-local.cy}) scale(${sx}, ${sy}) translate(${local.cx}, ${local.cy})`,
	);
	shapeEl.setAttribute("vector-effect", "non-scaling-stroke");
	shapeEl.setAttribute("stroke-width", shapeEl.getAttribute("stroke-width") ?? "1");
}

/** 射线-矩形求交：由节点中心指向相邻点，决定连线应从哪条边出发 */
export function sideOf(box: Box, toward: Point): AnchorSide {
	const dx = toward.x - box.cx;
	const dy = toward.y - box.cy;
	const tx = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity;
	const ty = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity;
	if (tx < ty) return dx < 0 ? "l" : "r";
	return dy < 0 ? "t" : "b";
}

/** 指定边上的锚点（沿边内缩，避免贴角） */
export function anchorOnSide(box: Box, side: AnchorSide, toward: Point): Point {
	const left = box.cx - box.w / 2;
	const right = box.cx + box.w / 2;
	const top = box.cy - box.h / 2;
	const bottom = box.cy + box.h / 2;
	const clampX = (x: number) => Math.min(right - SIDE_INSET, Math.max(left + SIDE_INSET, x));
	const clampY = (y: number) => Math.min(bottom - SIDE_INSET, Math.max(top + SIDE_INSET, y));
	switch (side) {
		case "l":
			return { x: left, y: clampY(toward.y) };
		case "r":
			return { x: right, y: clampY(toward.y) };
		case "t":
			return { x: clampX(toward.x), y: top };
		case "b":
			return { x: clampX(toward.x), y: bottom };
	}
}

/** 把折线的一端重锚到节点边界；保留正交走向（首末段轴对齐） */
export function reanchorEnd(points: Point[], index: number, box: Box, forced?: AnchorSide): void {
	const isStart = index === 0;
	const neighbor = isStart ? points[1] : points[points.length - 2];
	if (!neighbor) return;
	const side = forced ?? sideOf(box, neighbor);
	const anchor = anchorOnSide(box, side, neighbor);
	points[index] = anchor;
	// 两点直线没有正交约束；多点折线把相邻点对齐到锚点轴线
	if (points.length > 2) {
		if (side === "l" || side === "r") neighbor.y = anchor.y;
		else neighbor.x = anchor.x;
	}
}

/** 从 data-points（mermaid 的 btoa(JSON)）或 path d 里恢复点集 */
export function decodePoints(pathEl: Element): Point[] | null {
	const encoded = pathEl.getAttribute("data-points");
	if (encoded) {
		try {
			const parsed = JSON.parse(atob(encoded)) as unknown;
			if (Array.isArray(parsed)) {
				const pts = parsed
					.map((p) => (isPlainObject(p) && isFiniteNumber(p.x) && isFiniteNumber(p.y) ? { x: p.x, y: p.y } : null))
					.filter((p): p is Point => p !== null);
				if (pts.length >= 2) return pts;
			}
		} catch {
			// 回退解析 d
		}
	}
	const d = pathEl.getAttribute("d");
	if (!d) return null;
	const pts: Point[] = [];
	const re = /([ML])\s*([-\d.]+)[,\s]+([-\d.]+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(d)) !== null) pts.push({ x: Number(match[2]), y: Number(match[3]) });
	return pts.length >= 2 ? pts : null;
}

/** 写回折线路径与 data-points（保持 marker 等属性不变） */
export function setPathPoints(pathEl: Element, points: Point[]): void {
	const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${round1(p.x)},${round1(p.y)}`).join(" ");
	pathEl.setAttribute("d", d);
	try {
		pathEl.setAttribute("data-points", btoa(JSON.stringify(points)));
	} catch {
		// 编码失败不影响渲染，仅内部索引失效
	}
}

function parseTranslate(transform: string | null): { x: number; y: number; hasTranslate: boolean } {
	if (!transform) return { x: 0, y: 0, hasTranslate: false };
	const match = /translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/.exec(transform);
	if (!match) return { x: 0, y: 0, hasTranslate: false };
	return { x: Number(match[1]), y: Number(match[2]), hasTranslate: true };
}

function num(value: string | null): number | null {
	if (value === null || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
