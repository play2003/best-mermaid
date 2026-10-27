/**
 * V 键微调模式（会话与 UI 编排）：
 * - 容器聚焦（或悬停后按 V / 点铅笔按钮）进入编辑
 * - 拖动节点手柄缩放、双击改文字、拖连线端点/线段改走向
 * - 文字改写源码标签；几何写入 %% bm-tune %% 注释，保存时一次原子落盘
 *
 * 编辑态强制 1x 并 suspend 交互服务：坐标基准稳定，覆盖层与 svg 用户坐标一一对应。
 */
import { setIcon } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { BmTuneData, EdgeTune, NodeTune, TuneError } from "../types";
import {
	anchorOnSide,
	applyTuneOverlay,
	decodePoints,
	edgeKey,
	measureNodeBox,
	nodeKey,
	sideOf,
	type Box,
	type Point,
} from "../pipeline/tune-overlay";
import {
	applyTextEdits,
	extractTuneDirective,
	isFlowchartSource,
	scanFlowchartSource,
	upsertTuneDirective,
	type EdgeOccurrence,
	type PendingEdit,
	type ScanResult,
} from "./tune-source";
import type { InteractionService } from "./interaction";
import type { TunePersistence, TunePersistenceError } from "./tune-persistence";
import { t } from "../i18n";

const SVG_NS = "http://www.w3.org/2000/svg";
const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandleDir = (typeof HANDLE_DIRS)[number];
const HANDLE_PX = 9;
const MIN_W = 40;
const MIN_H = 24;
const DRAG_START = 3;
/** 悬停后按 V 的有效窗口（毫秒） */
const HOVER_WINDOW = 800;

export interface TuneAttachOptions {
	tune: BmTuneData | null;
	tuneError: TuneError;
	rawSource: string;
	ctx: MarkdownPostProcessorContext | null;
}

export interface TuneModeDeps {
	isEnabled: () => boolean;
	interaction: InteractionService;
	persistence: TunePersistence;
	getRawSource: (el: HTMLElement) => string | undefined;
	getCtx: (el: HTMLElement) => MarkdownPostProcessorContext | null;
	/** 用新源码立即重渲染（保存/取消/重置后） */
	refresh: (el: HTMLElement, source: string) => void;
	/** 保存前预校验源码，返回 null=通过，否则为错误信息 */
	validate?: (source: string) => Promise<string | null>;
	notify: (message: string) => void;
}

type Selection =
	| { kind: "node"; id: string }
	| { kind: "edge"; id: string; from: string; to: string }
	| null;

interface Session {
	el: HTMLElement;
	svg: SVGSVGElement;
	rawSource: string;
	/** 取消时用于恢复笔记已保存状态（Reset 后仍指向最初源码） */
	cancelSource: string;
	sourcePath: string;
	ctx: MarkdownPostProcessorContext | null;
	scan: ScanResult;
	tune: BmTuneData;
	tuneError: TuneError;
	selection: Selection;
	pending: Map<string, PendingEdit>;
	editing: boolean;
	saving: boolean;
	dirty: boolean;
	baseController: AbortController;
	editController: AbortController | null;
	layer: SVGSVGElement | null;
	hud: HTMLElement | null;
	inline: HTMLTextAreaElement | null;
	resizeObserver: ResizeObserver | null;
	editButton: HTMLButtonElement | null;
}

type DragState =
	| { kind: "resize"; nodeId: string; dir: HandleDir; start: Point; box: Box }
	| {
			kind: "endpoint";
			edgeId: string;
			from: string;
			to: string;
			end: 0 | 1;
			pts: Point[];
			box: Box;
	  }
	| {
			kind: "segment";
			edgeId: string;
			from: string;
			to: string;
			index: number;
			start: Point;
			pts: Point[];
	  };

export class TuneModeService {
	private sessions = new WeakMap<HTMLElement, Session>();
	private all = new Set<Session>();
	private reenter = new WeakSet<HTMLElement>();
	private cancelSourceOverride = new WeakMap<HTMLElement, string>();
	/** Reset 后重新进入编辑时，保留尚未保存的文字修改 */
	private pendingCarry = new WeakMap<HTMLElement, Map<string, PendingEdit>>();
	private hovered = new WeakMap<HTMLElement, number>();
	private docKeyHandler: ((ev: KeyboardEvent) => void) | null = null;

	constructor(private deps: TuneModeDeps) {
		this.docKeyHandler = (ev: KeyboardEvent) => {
			if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
			if (ev.key.toLowerCase() !== "v") return;
			if (isTypingTarget(ev.target)) return;
			const active = document.activeElement;
			if (active && active !== document.body) return;
			const now = Date.now();
			for (const session of this.all) {
				const at = this.hovered.get(session.el) ?? 0;
				if (now - at < HOVER_WINDOW && !session.editing) {
					ev.preventDefault();
					this.enterEdit(session);
					return;
				}
			}
		};
		document.addEventListener("keydown", this.docKeyHandler);
	}

	attach(el: HTMLElement, svg: SVGSVGElement, opts: TuneAttachOptions): void {
		this.detach(el);

		const enabled = this.deps.isEnabled();
		const eligible = enabled && isFlowchartSource(opts.rawSource) && svg.querySelector("g.node") !== null;
		if (!eligible) {
			el.removeAttribute("tabindex");
			delete el.dataset.bmTuneReady;
			return;
		}

		el.tabIndex = 0;
		el.dataset.bmTuneReady = "1";
		const button = el.createEl("button", { cls: "best-mermaid-tune-btn" });
		button.type = "button";
		button.title = t("tuneMode");
		button.setAttribute("aria-label", t("tuneMode"));
		setIcon(button, "pencil");

		const controller = new AbortController();
		const { signal } = controller;
		const session: Session = {
			el,
			svg,
			rawSource: opts.rawSource,
			cancelSource: this.cancelSourceOverride.get(el) ?? opts.rawSource,
			sourcePath: el.dataset.bmSourcePath ?? "",
			ctx: opts.ctx,
			scan: scanFlowchartSource(opts.rawSource),
			tune: cloneTune(opts.tune),
			tuneError: opts.tuneError,
			selection: null,
			pending: this.pendingCarry.get(el) ?? new Map(),
			editing: false,
			saving: false,
			dirty: false,
			baseController: controller,
			editController: null,
			layer: null,
			hud: null,
			inline: null,
			resizeObserver: null,
			editButton: button,
		};
		this.cancelSourceOverride.delete(el);
		this.pendingCarry.delete(el);
		this.sessions.set(el, session);
		this.all.add(session);

		button.addEventListener(
			"click",
			(ev) => {
				ev.stopPropagation();
				this.enterEdit(session);
			},
			{ signal },
		);

		el.addEventListener(
			"pointerdown",
			(ev) => {
				if (session.editing) return;
				const target = ev.target;
				if (target instanceof Element && target.closest("button, input, textarea, select, a")) return;
				el.focus({ preventScroll: true });
			},
			{ capture: true, signal },
		);

		el.addEventListener(
			"keydown",
			(ev) => this.onKeydown(session, ev),
			{ signal },
		);

		el.addEventListener(
			"pointerenter",
			() => this.hovered.set(el, Date.now()),
			{ signal },
		);

		el.addEventListener(
			"dblclick",
			(ev) => {
				if (!session.editing || session.inline) return;
				const target = ev.target;
				if (!(target instanceof Element)) return;
				if (target.closest(".best-mermaid-tune-hud, .best-mermaid-tune-btn")) return;
				const info = this.resolveTextTarget(session, target);
				if (!info) return;
				ev.preventDefault();
				ev.stopPropagation();
				this.openInlineEditor(session, info);
			},
			{ signal },
		);

		if (this.reenter.has(el)) {
			this.reenter.delete(el);
			this.enterEdit(session);
		}
	}

	detach(el: HTMLElement): void {
		const session = this.sessions.get(el);
		if (!session) return;
		this.closeEdit(session);
		session.baseController.abort();
		session.editButton?.remove();
		el.removeClass("bm-tuning");
		this.sessions.delete(el);
		this.all.delete(session);
	}

	isEditing(el: HTMLElement): boolean {
		return this.sessions.get(el)?.editing === true;
	}

	dispose(): void {
		if (this.docKeyHandler) {
			document.removeEventListener("keydown", this.docKeyHandler);
			this.docKeyHandler = null;
		}
		for (const session of Array.from(this.all)) {
			this.closeEdit(session);
			session.baseController.abort();
			session.editButton?.remove();
			session.el.removeClass("bm-tuning");
		}
		this.all.clear();
	}

	// ── 编辑会话 ──────────────────────────────────────────────

	private enterEdit(session: Session): void {
		if (session.editing) return;
		session.editing = true;
		session.el.addClass("bm-tuning");
		this.deps.interaction.suspend(session.el);
		this.deps.interaction.reset(session.el, session.svg);

		const controller = new AbortController();
		session.editController = controller;
		const { signal } = controller;

		session.el.addEventListener(
			"pointerdown",
			(ev) => this.onEditPointerDown(session, ev),
			{ signal },
		);

		session.layer = this.createLayer(session);
		session.hud = this.createHud(session);

		if (typeof ResizeObserver !== "undefined") {
			session.resizeObserver = new ResizeObserver(() => this.layoutLayer(session));
			session.resizeObserver.observe(session.svg);
		}
		this.layoutLayer(session);
	}

	private closeEdit(session: Session): void {
		session.editController?.abort();
		session.editController = null;
		session.resizeObserver?.disconnect();
		session.resizeObserver = null;
		session.layer?.remove();
		session.layer = null;
		session.hud?.remove();
		session.hud = null;
		session.inline?.remove();
		session.inline = null;
		session.selection = null;
		if (session.editing) {
			session.editing = false;
			session.el.removeClass("bm-tuning");
			this.deps.interaction.resume(session.el);
		}
	}

	private onKeydown(session: Session, ev: KeyboardEvent): void {
		if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
		if (isTypingTarget(ev.target)) return;

		if (!session.editing) {
			if (ev.key.toLowerCase() === "v") {
				ev.preventDefault();
				ev.stopPropagation();
				this.enterEdit(session);
			}
			return;
		}
		if (ev.key.toLowerCase() === "v" || ev.key === "Enter") {
			ev.preventDefault();
			void this.save(session);
		} else if (ev.key === "Escape" && !session.inline) {
			ev.preventDefault();
			this.cancel(session);
		}
	}

	// ── 覆盖层与 HUD ──────────────────────────────────────────

	private createLayer(session: Session): SVGSVGElement {
		const layer = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
		layer.classList.add("best-mermaid-tune-layer");
		const vb = viewBoxOf(session.svg);
		if (vb) layer.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
		layer.setAttribute("preserveAspectRatio", "none");
		session.el.appendChild(layer);
		return layer;
	}

	private layoutLayer(session: Session): void {
		if (!session.layer) return;
		const svgRect = session.svg.getBoundingClientRect();
		const containerRect = session.el.getBoundingClientRect();
		session.layer.setCssStyles({
			left: `${svgRect.left - containerRect.left}px`,
			top: `${svgRect.top - containerRect.top}px`,
			width: `${svgRect.width}px`,
			height: `${svgRect.height}px`,
		});
	}

	private createHud(session: Session): HTMLElement {
		const hud = session.el.createDiv({ cls: "best-mermaid-tune-hud" });
		hud.createSpan({ cls: "bm-tune-hint", text: t("tuneHint") });

		const makeButton = (icon: string, label: string, onClick: () => void): HTMLButtonElement => {
			const btn = hud.createEl("button", { cls: "bm-tune-btn" });
			btn.type = "button";
			btn.title = label;
			btn.setAttribute("aria-label", label);
			setIcon(btn, icon);
			btn.addEventListener("click", onClick, { signal: session.editController?.signal });
			return btn;
		};

		makeButton("check", t("tuneSave"), () => void this.save(session));
		makeButton("x", t("tuneCancel"), () => this.cancel(session));
		makeButton("rotate-ccw", t("tuneReset"), () => this.reset(session));
		return hud;
	}

	private markDirty(session: Session): void {
		session.dirty = true;
		session.hud?.addClass("bm-tune-dirty");
	}

	/** 把当前 tune 重放到 svg，并刷新选择框/手柄 */
	private applyTune(session: Session): void {
		applyTuneOverlay(session.svg, session.tune);
		this.renderSelection(session);
	}

	private renderSelection(session: Session): void {
		const layer = session.layer;
		if (!layer) return;
		while (layer.firstChild) layer.removeChild(layer.firstChild);
		const selection = session.selection;
		if (!selection) return;

		const vb = viewBoxOf(session.svg);
		const rect = session.svg.getBoundingClientRect();
		const scale = vb && rect.width > 0 ? rect.width / vb.width : 1;
		const handle = HANDLE_PX / Math.max(scale, 0.0001);

		if (selection.kind === "node") {
			const group = findNodeGroup(session.svg, selection.id);
			const box = group ? measureNodeBox(group) : null;
			if (!box) return;
			this.addOutline(layer, box);
			const points: Record<HandleDir, Point> = {
				nw: { x: box.cx - box.w / 2, y: box.cy - box.h / 2 },
				n: { x: box.cx, y: box.cy - box.h / 2 },
				ne: { x: box.cx + box.w / 2, y: box.cy - box.h / 2 },
				e: { x: box.cx + box.w / 2, y: box.cy },
				se: { x: box.cx + box.w / 2, y: box.cy + box.h / 2 },
				s: { x: box.cx, y: box.cy + box.h / 2 },
				sw: { x: box.cx - box.w / 2, y: box.cy + box.h / 2 },
				w: { x: box.cx - box.w / 2, y: box.cy },
			};
			for (const dir of HANDLE_DIRS) {
				const p = points[dir];
				const el = this.svgEl("rect", {
					x: p.x - handle / 2,
					y: p.y - handle / 2,
					width: handle,
					height: handle,
					class: "bm-tune-handle",
					"data-dir": dir,
				});
				el.addEventListener(
					"pointerdown",
					(ev) => {
						ev.preventDefault();
						ev.stopPropagation();
						this.beginResize(session, selection.id, dir, box, ev);
					},
					{ signal: session.editController?.signal },
				);
				layer.appendChild(el);
			}
			return;
		}

		const pathEl = findEdgePath(session.svg, selection.id);
		if (!pathEl) return;
		const pts = decodePoints(pathEl);
		if (!pts) return;
		layer.appendChild(
			this.svgEl("path", {
				d: pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" "),
				class: "bm-tune-edge-hl",
			}),
		);
		for (const [index, p] of [pts[0], pts[pts.length - 1]].entries()) {
			const el = this.svgEl("circle", { cx: p.x, cy: p.y, r: handle / 2, class: "bm-tune-handle" });
			el.addEventListener(
				"pointerdown",
				(ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					this.beginEndpointDrag(session, selection, index === 0 ? 0 : 1, pts, ev);
				},
				{ signal: session.editController?.signal },
			);
			layer.appendChild(el);
		}
	}

	private addOutline(layer: SVGSVGElement, box: Box): void {
		layer.appendChild(
			this.svgEl("rect", {
				x: box.cx - box.w / 2,
				y: box.cy - box.h / 2,
				width: box.w,
				height: box.h,
				class: "bm-tune-outline",
			}),
		);
	}

	private svgEl(name: string, attrs: Record<string, string | number>): SVGElement {
		const el = document.createElementNS(SVG_NS, name) as SVGElement;
		for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
		return el;
	}

	// ── 指针：选择 / 缩放 / 连线 ──────────────────────────────

	private onEditPointerDown(session: Session, ev: PointerEvent): void {
		const target = ev.target;
		if (!(target instanceof Element)) return;
		if (target.closest(".best-mermaid-tune-hud, .best-mermaid-tune-btn, .bm-tune-inline-editor")) return;
		if (target.closest(".best-mermaid-tune-layer")) return; // 手柄自己处理

		const nodeGroup = target.closest("g.node");
		if (nodeGroup) {
			const id = nodeKey(nodeGroup);
			if (id) {
				session.selection = { kind: "node", id };
				this.renderSelection(session);
			}
			return;
		}

		// 直接点在线上
		const pathEl = target.closest("path[data-id]") as SVGPathElement | null;
		if (pathEl) {
			const id = edgeKey(pathEl);
			const ref = this.edgeRef(session, id ?? "");
			if (id && ref) {
				this.selectEdge(session, id, ref, pathEl, ev);
				return;
			}
		}

		// 点在边标签上（标签遮挡了线下半段，是"选不中"的常见原因）
		const edgeLabel = target.closest("g.edgeLabel");
		if (edgeLabel) {
			const id = edgeLabel.querySelector("[data-id]")?.getAttribute("data-id") ?? null;
			const ref = id ? this.edgeRef(session, id) : null;
			if (id && ref) {
				const labelPath = findEdgePath(session.svg, id);
				if (labelPath) {
					this.selectEdge(session, id, ref, labelPath, ev);
					return;
				}
			}
		}

		// 细线命中区太小：按几何距离兜底（8px 容差），点击空白处才清空选择
		const near = this.findEdgeNear(session, ev);
		if (near) {
			this.selectEdge(session, near.id, near, near.pathEl, ev);
			return;
		}

		session.selection = null;
		this.renderSelection(session);
	}

	private selectEdge(
		session: Session,
		id: string,
		ref: { from: string; to: string },
		pathEl: SVGPathElement,
		ev: PointerEvent,
	): void {
		session.selection = { kind: "edge", id, from: ref.from, to: ref.to };
		this.renderSelection(session);
		this.beginSegmentDrag(session, id, ref.from, ref.to, pathEl, ev);
	}

	/** 距离最近的连线（按 8px 屏幕容差换算到用户坐标） */
	private findEdgeNear(
		session: Session,
		ev: PointerEvent,
	): { id: string; from: string; to: string; pathEl: SVGPathElement } | null {
		const point = this.toUser(session, ev.clientX, ev.clientY);
		const rect = session.svg.getBoundingClientRect();
		const vb = viewBoxOf(session.svg);
		if (!point || !vb || rect.width === 0) return null;
		const tolerance = (8 * vb.width) / rect.width;

		let best: { id: string; from: string; to: string; pathEl: SVGPathElement } | null = null;
		let bestDistance = Infinity;
		for (const pathEl of Array.from(session.svg.querySelectorAll("path[data-id]"))) {
			const id = edgeKey(pathEl);
			if (!id) continue;
			const ref = this.edgeRef(session, id);
			if (!ref) continue;
			const pts = decodePoints(pathEl as SVGPathElement);
			if (!pts) continue;
			let distance = Infinity;
			for (let i = 0; i < pts.length - 1; i++) {
				distance = Math.min(distance, distanceToSegment(point, pts[i], pts[i + 1]));
			}
			if (distance < bestDistance) {
				bestDistance = distance;
				best = { id, from: ref.from, to: ref.to, pathEl: pathEl as SVGPathElement };
			}
		}
		return bestDistance <= tolerance ? best : null;
	}

	private beginResize(session: Session, nodeId: string, dir: HandleDir, startBox: Box, ev: PointerEvent): void {
		const start = this.toUser(session, ev.clientX, ev.clientY);
		if (!start) return;
		this.trackDrag(session, { kind: "resize", nodeId, dir, start, box: startBox }, ev, (state, move) => {
			const p = this.toUser(session, move.clientX, move.clientY);
			if (!p || state.kind !== "resize") return;
			let left = state.box.cx - state.box.w / 2;
			let right = state.box.cx + state.box.w / 2;
			let top = state.box.cy - state.box.h / 2;
			let bottom = state.box.cy + state.box.h / 2;
			const dx = p.x - state.start.x;
			const dy = p.y - state.start.y;
			if (dir.includes("w")) left = Math.min(right - MIN_W, left + dx);
			if (dir.includes("e")) right = Math.max(left + MIN_W, right + dx);
			if (dir.includes("n")) top = Math.min(bottom - MIN_H, top + dy);
			if (dir.includes("s")) bottom = Math.max(top + MIN_H, bottom + dy);

			const node: NodeTune = {
				x: (left + right) / 2,
				y: (top + bottom) / 2,
				w: right - left,
				h: bottom - top,
			};
			session.tune.nodes = { ...(session.tune.nodes ?? {}), [nodeId]: node };
			this.markDirty(session);
			this.applyTune(session);
		});
	}

	private beginEndpointDrag(
		session: Session,
		selection: { kind: "edge"; id: string; from: string; to: string },
		end: 0 | 1,
		pts: Point[],
		ev: PointerEvent,
	): void {
		const nodeId = end === 0 ? selection.from : selection.to;
		const group = findNodeGroup(session.svg, nodeId);
		const box = group ? measureNodeBox(group) : null;
		if (!box) return;
		this.trackDrag(
			session,
			{ kind: "endpoint", edgeId: selection.id, from: selection.from, to: selection.to, end, pts, box },
			ev,
			(state, move) => {
				if (state.kind !== "endpoint") return;
				const p = this.toUser(session, move.clientX, move.clientY);
				if (!p) return;
				const side = sideOf(state.box, p);
				const anchor = anchorOnSide(state.box, side, p);
				const current = this.sessionPoints(session, state.edgeId) ?? state.pts.map((q) => ({ ...q }));
				if (current.length < 2) return;
				current[state.end === 0 ? 0 : current.length - 1] = anchor;

				const next: EdgeTune = { from: state.from, to: state.to, pts: current.map((q) => [q.x, q.y]) };
				if (state.end === 0) next.src = side;
				else next.dst = side;
				session.tune.edges = { ...(session.tune.edges ?? {}), [state.edgeId]: next };
				this.markDirty(session);
				this.applyTune(session);
			},
		);
	}

	private beginSegmentDrag(
		session: Session,
		edgeId: string,
		from: string,
		to: string,
		pathEl: SVGPathElement,
		ev: PointerEvent,
	): void {
		const start = this.toUser(session, ev.clientX, ev.clientY);
		const pts = decodePoints(pathEl);
		if (!start || !pts || pts.length < 2) return;
		const index = nearestSegment(pts, start);
		this.trackDrag(
			session,
			{ kind: "segment", edgeId, from, to, index, start, pts },
			ev,
			(state, move, total) => {
				if (state.kind !== "segment" || total < DRAG_START) return;
				const p = this.toUser(session, move.clientX, move.clientY);
				if (!p) return;
				const a = state.pts[state.index];
				const b = state.pts[state.index + 1];
				const nx = p.x - state.start.x;
				const ny = p.y - state.start.y;
				const next = state.pts.map((q) => ({ ...q }));
				const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
				if (horizontal) {
					next[state.index].y = a.y + ny;
					next[state.index + 1].y = b.y + ny;
				} else {
					next[state.index].x = a.x + nx;
					next[state.index + 1].x = b.x + nx;
				}
				session.tune.edges = {
					...(session.tune.edges ?? {}),
					[state.edgeId]: { from: state.from, to: state.to, pts: next.map((q) => [q.x, q.y]) },
				};
				this.markDirty(session);
				this.applyTune(session);
			},
		);
	}

	/** 统一的拖拽收尾：window 监听 + 抬手/取消清理 */
	private trackDrag(
		session: Session,
		state: DragState,
		origin: { clientX: number; clientY: number },
		onMove: (state: DragState, ev: PointerEvent, total: number) => void,
	): void {
		void session;
		const controller = new AbortController();
		const { signal } = controller;
		const cleanup = () => controller.abort();
		window.addEventListener(
			"pointermove",
			(ev) => {
				const total = Math.hypot(ev.clientX - origin.clientX, ev.clientY - origin.clientY);
				onMove(state, ev, total);
			},
			{ signal },
		);
		window.addEventListener("pointerup", cleanup, { signal, once: true });
		window.addEventListener("pointercancel", cleanup, { signal, once: true });
	}

	// ── 文字编辑 ──────────────────────────────────────────────

	private resolveTextTarget(
		session: Session,
		target: Element,
	): { key: string; edit: PendingEdit; value: string } | null {
		const nodeGroup = target.closest("g.node");
		if (nodeGroup) {
			const id = nodeKey(nodeGroup);
			if (!id) return null;
			const occurrence = session.scan.nodes.find((n) => n.id === id);
			return {
				key: `node:${id}`,
				edit: { kind: "node", id, text: "" },
				// 裸节点（A --> B）：保存时补一行定义，初值为空
				value: occurrence ? this.labelText(session, occurrence) : "",
			};
		}

		const edgeEl = target.closest("g.edgeLabel, path[data-id]");
		if (!edgeEl) return null;
		const id =
			edgeEl.getAttribute("data-id") ??
			edgeEl.querySelector("[data-id]")?.getAttribute("data-id") ??
			null;
		if (!id) return null;
		const ref = this.edgeRef(session, id);
		if (!ref) return null;
		const occurrence = uniqueEdgeOccurrence(session.scan, ref.from, ref.to);
		if (!occurrence) return null;
		const labelStart = occurrence.labelStart;
		const labelEnd = occurrence.labelEnd;
		return {
			key: `edge:${ref.from}>${ref.to}`,
			edit: { kind: "edge", from: ref.from, to: ref.to, text: "" },
			value: labelStart !== null && labelEnd !== null ? this.labelText(session, { line: occurrence.line, labelStart, labelEnd }) : "",
		};
	}

	private labelText(session: Session, occurrence: { line: number; labelStart: number; labelEnd: number }): string {
		const line = session.rawSource.split(/\r?\n/)[occurrence.line] ?? "";
		return decodeLabel(line.slice(occurrence.labelStart, occurrence.labelEnd));
	}

	private openInlineEditor(
		session: Session,
		info: { key: string; edit: PendingEdit; value: string },
	): void {
		const svgRect = session.svg.getBoundingClientRect();
		const containerRect = session.el.getBoundingClientRect();
		const editor = document.createElement("textarea");
		editor.classList.add("bm-tune-inline-editor");
		editor.value = info.value;
		editor.setCssStyles({
			left: `${svgRect.left - containerRect.left + 12}px`,
			top: `${svgRect.top - containerRect.top + 12}px`,
			minWidth: "220px",
		});
		session.el.appendChild(editor);
		session.inline = editor;
		editor.focus();
		editor.select();

		let closed = false;
		const close = () => {
			closed = true;
			editor.remove();
			if (session.inline === editor) session.inline = null;
		};
		const commit = () => {
			if (closed) return;
			const text = editor.value;
			const edit = { ...info.edit, text } as PendingEdit;
			session.pending.set(info.key, edit);
			this.markDirty(session);
			this.previewText(session, info.edit, text);
			close();
		};

		editor.addEventListener("keydown", (ev) => {
			ev.stopPropagation();
			if (ev.key === "Enter" && !ev.shiftKey) {
				ev.preventDefault();
				commit();
			} else if (ev.key === "Escape") {
				ev.preventDefault();
				close();
			}
		});
		editor.addEventListener("blur", commit);
	}

	/** 保存前的即时预览（最终效果以重渲染为准） */
	private previewText(session: Session, edit: PendingEdit, text: string): void {
		const plain = decodeLabel(text);
		try {
			if (edit.kind === "node") {
				const group = findNodeGroup(session.svg, edit.id);
				const label = group?.querySelector("g.label, .label");
				const textEl = label?.querySelector("text, span");
				if (textEl) textEl.textContent = plain;
			} else {
				for (const label of Array.from(session.svg.querySelectorAll("g.edgeLabel .label"))) {
					const id = label.getAttribute("data-id");
					if (!id) continue;
					const ref = this.edgeRef(session, id);
					if (ref?.from !== edit.from || ref?.to !== edit.to) continue;
					const textEl = label.querySelector("text, span");
					if (textEl) textEl.textContent = plain;
				}
			}
		} catch {
			// 预览失败不影响保存
		}
	}

	// ── 保存 / 取消 / 重置 ────────────────────────────────────

	private async save(session: Session): Promise<void> {
		if (session.saving) return;
		if (session.tuneError === "version") {
			this.deps.notify(t("tuneStaleVersion"));
			return;
		}
		session.saving = true;
		try {
			const textResult = applyTextEdits(session.rawSource, Array.from(session.pending.values()));
			if (textResult.error) {
				this.deps.notify(`${t("tuneUnsupportedLabel")} (${textResult.error})`);
				return;
			}
			const next = upsertTuneDirective(textResult.source, session.tune);
			if (this.deps.validate) {
				const invalid = await this.deps.validate(next);
				if (invalid) {
					this.deps.notify(`${t("tuneSaveFailed")}: ${invalid}`);
					return;
				}
			}
			await this.deps.persistence.save(
				{ sourcePath: session.sourcePath, rawSource: session.rawSource, ctx: session.ctx, el: session.el },
				next,
			);
			this.deps.notify(t("tuneSaved"));
			this.closeEdit(session);
			this.deps.refresh(session.el, next);
		} catch (error) {
			this.deps.notify(`${t("tuneSaveFailed")}: ${this.describeError(error)}`);
		} finally {
			session.saving = false;
		}
	}

	private cancel(session: Session): void {
		this.closeEdit(session);
		this.deps.refresh(session.el, session.cancelSource);
	}

	/**
	 * 重置几何：用去掉 bm-tune 指令的源码重渲染，并自动重新进入编辑。
	 * 取消时仍恢复到最初笔记状态（cancelSource 已保留）。
	 */
	private reset(session: Session): void {
		this.cancelSourceOverride.set(session.el, session.cancelSource);
		this.pendingCarry.set(session.el, new Map(session.pending));
		session.tune = { v: 1, nodes: {}, edges: {} };
		const clean = extractTuneDirective(session.rawSource).clean;
		this.reenter.add(session.el);
		this.closeEdit(session);
		this.deps.refresh(session.el, clean);
	}

	private describeError(error: unknown): string {
		const code = (error as Partial<TunePersistenceError> | null)?.code;
		switch (code) {
			case "no-source-path":
			case "file-not-found":
			case "block-not-found":
			case "block-ambiguous":
				return t("tuneLocateFailed");
			default:
				return error instanceof Error ? error.message : String(error);
		}
	}

	// ── 工具 ──────────────────────────────────────────────────

	private edgeRef(session: Session, edgeId: string): { from: string; to: string } | null {
		const tuned = session.tune.edges?.[edgeId];
		if (tuned?.from && tuned.to) return { from: tuned.from, to: tuned.to };
		const match = /^L_([^_]+)_([^_]+)_\d+$/.exec(edgeId);
		if (match) return { from: match[1], to: match[2] };
		// 自定义边 id（A e1@--> B）：从源码扫描结果反查
		const occurrence = session.scan.edges.find((e) => e.userEdgeId === edgeId);
		return occurrence ? { from: occurrence.from, to: occurrence.to } : null;
	}

	/** 当前 svg 上该边的点集（拖动时以实时几何为基准） */
	private sessionPoints(session: Session, edgeId: string): Point[] | null {
		const pathEl = findEdgePath(session.svg, edgeId);
		return pathEl ? decodePoints(pathEl) : null;
	}

	private toUser(session: Session, clientX: number, clientY: number): Point | null {
		const rect = session.svg.getBoundingClientRect();
		const vb = viewBoxOf(session.svg);
		if (!vb || rect.width === 0 || rect.height === 0) return null;
		return {
			x: vb.x + ((clientX - rect.left) * vb.width) / rect.width,
			y: vb.y + ((clientY - rect.top) * vb.height) / rect.height,
		};
	}
}

function cloneTune(tune: BmTuneData | null): BmTuneData {
	if (!tune) return { v: 1, nodes: {}, edges: {} };
	return JSON.parse(JSON.stringify(tune)) as BmTuneData;
}

function findNodeGroup(svg: SVGSVGElement, id: string): Element | null {
	for (const group of Array.from(svg.querySelectorAll("g.node"))) {
		if (nodeKey(group) === id) return group;
	}
	return null;
}

function findEdgePath(svg: SVGSVGElement, id: string): SVGPathElement | null {
	return svg.querySelector(`path[data-id="${cssEscape(id)}"]`) as SVGPathElement | null;
}

function cssEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}

function uniqueEdgeOccurrence(scan: ScanResult, from: string, to: string): EdgeOccurrence | null {
	const matches = scan.edges.filter((e) => e.from === from && e.to === to);
	return matches.length === 1 ? matches[0] : null;
}

function nearestSegment(pts: Point[], p: Point): number {
	let best = 0;
	let bestDistance = Infinity;
	for (let i = 0; i < pts.length - 1; i++) {
		const d = distanceToSegment(p, pts[i], pts[i + 1]);
		if (d < bestDistance) {
			bestDistance = d;
			best = i;
		}
	}
	return best;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function viewBoxOf(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } | null {
	const vb = svg.viewBox?.baseVal;
	if (vb && vb.width > 0 && vb.height > 0) return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
	const width = Number(svg.getAttribute("width"));
	const height = Number(svg.getAttribute("height"));
	return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
	const el = target instanceof Element ? target : null;
	return !!el?.closest("input, textarea, select, [contenteditable='true'], .cm-editor, .bm-tune-inline-editor");
}

function decodeLabel(raw: string): string {
	const stripped = raw.replace(/^\s*(["`])([\s\S]*)\1\s*$/, "$2");
	return stripped
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/#quot;/g, '"')
		.replace(/#124;/g, "|")
		.trim();
}
