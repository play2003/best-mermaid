/**
 * 交互服务：容器内缩放/平移。
 * - Ctrl+滚轮缩放（Windows 触控板双指捏合发的就是带 ctrlKey 的 wheel），锚点为鼠标位置
 * - 左键拖拽平移，仅放大（scale>1）后可用，5px 位移阈值区分"点击"与"拖拽"
 * - 双击回 1x；缩放状态存容器 dataset，SVG 重建后 attach 时自动回放
 *
 * 无实例状态：容器被 Obsidian 替换时，其上的监听与 dataset 状态自然消亡。
 */
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
/** 容器内覆盖按钮（导出等）：不参与缩放/拖拽/双击手势 */
const OVERLAY_SELECTOR = ".best-mermaid-export";
/** 指数缩放步进：任意倍率下手感一致 */
const ZOOM_STEP = 1.1;
/** 位移超过该值才算拖拽（像素），阈值内松手视为点击 */
const DRAG_THRESHOLD = 5;
/** 停止缩放多久后检查吸附回正（毫秒） */
const SNAP_DELAY = 180;

export class InteractionService {
	constructor(private enabled: () => boolean) {}

	attach(container: HTMLElement, svg: SVGSVGElement): void {
		if (!this.enabled()) return;

		const state = {
			scale: Number(container.dataset.bmScale) || 1,
			tx: Number(container.dataset.bmTx) || 0,
			ty: Number(container.dataset.bmTy) || 0,
		};

		let dragging = false;
		let downX = 0;
		let downY = 0;
		let lastX = 0;
		let lastY = 0;
		let snapTimer: number | undefined;

		const apply = (animate = false) => {
			svg.style.transition = animate ? "" : "none";
			svg.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
			container.dataset.bmScale = String(state.scale);
			container.dataset.bmTx = String(state.tx);
			container.dataset.bmTy = String(state.ty);
			// 小手光标：放大后可拖（悬停 grab / 拖拽中 grabbing）
			container.style.cursor = state.scale > 1 ? (dragging ? "grabbing" : "grab") : "";
		};

		/** 以 (clientX, clientY) 为锚点缩放：保持鼠标下的图内容不动 */
		const zoomAt = (clientX: number, clientY: number, factor: number) => {
			const rect = container.getBoundingClientRect();
			const px = clientX - rect.left;
			const py = clientY - rect.top;
			const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
			// p = t + q*s（q 为图内坐标）⇒ 锚定 q 不变解出 t'
			state.tx = px - ((px - state.tx) / state.scale) * next;
			state.ty = py - ((py - state.ty) / state.scale) * next;
			state.scale = next;
			apply(true);
		};

		const snapBack = () => {
			if (state.scale < 1) {
				state.scale = 1;
				state.tx = 0;
				state.ty = 0;
				apply(true);
			}
		};

		const isOverlayTarget = (target: EventTarget | null): boolean =>
			target instanceof Element && target.closest(OVERLAY_SELECTOR) !== null;

		const onWheel = (ev: WheelEvent) => {
			if (isOverlayTarget(ev.target)) return;
			if (!ev.ctrlKey) return; // 不拦截普通滚动
			ev.preventDefault();
			window.clearTimeout(snapTimer);
			zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
			snapTimer = window.setTimeout(snapBack, SNAP_DELAY);
		};

		const onDown = (ev: PointerEvent) => {
			if (isOverlayTarget(ev.target)) return;
			if (ev.button !== 0 || state.scale <= 1) return; // 未放大时不抢占，文本可选中
			downX = ev.clientX;
			downY = ev.clientY;
			container.setPointerCapture(ev.pointerId);
		};

		const onMove = (ev: PointerEvent) => {
			if (ev.buttons !== 1 || state.scale <= 1) return;
			if (!dragging && Math.hypot(ev.clientX - downX, ev.clientY - downY) < DRAG_THRESHOLD) return;
			if (!dragging) {
				dragging = true;
				container.style.userSelect = "none"; // 拖拽期间禁止选字
				lastX = ev.clientX;
				lastY = ev.clientY;
			}
			state.tx += ev.clientX - lastX;
			state.ty += ev.clientY - lastY;
			lastX = ev.clientX;
			lastY = ev.clientY;
			apply();
		};

		const onUp = (ev: PointerEvent) => {
			if (!dragging) return;
			dragging = false;
			container.style.userSelect = "";
			try {
				container.releasePointerCapture(ev.pointerId);
			} catch {
				// capture 已随元素移除等场景失效，无需处理
			}
			apply(true);
		};

		const onDblClick = (ev: MouseEvent) => {
			if (isOverlayTarget(ev.target)) return;
			if (state.scale === 1 && state.tx === 0 && state.ty === 0) return;
			ev.preventDefault();
			state.scale = 1;
			state.tx = 0;
			state.ty = 0;
			apply(true);
		};

		container.addEventListener("wheel", onWheel, { passive: false });
		container.addEventListener("pointerdown", onDown);
		container.addEventListener("pointermove", onMove);
		container.addEventListener("pointerup", onUp);
		container.addEventListener("pointercancel", onUp);
		container.addEventListener("dblclick", onDblClick);

		apply(); // 回放容器 dataset 中的既有状态（SVG 可能刚被 Obsidian 重建）
	}
}
