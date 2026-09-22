// 交互适配器（契约 01 §4 InteractionAdapter；T105/T107，ADR-002 移除 Moveable 后自研）。
// 拖拽手势用原生 pointer 驱动（跨 iframe realm 可靠）：死区判定 + Shift 单轴 + rAF 写 transform。
// T107：拖拽中临近兄弟边吸附（core 计算 Guide），外壳画吸附线；位移只用 transform，不改 position。
// 选中框/8 手柄/吸附线均由 OverlayLayer 自绘，本类不再依赖 moveable。

import type {
  DragMoveEvent,
  Guide,
  InteractionAdapter,
  ResizeEvent,
} from '../../core/ports';
import { INTERACTION } from '../../constants';
import { applyTranslate } from '../../core/interaction/transform';
import { shouldStartDrag } from '../../core/interaction/dragIntent';
import {
  computeEdgeGuides,
  computeEqualSpacing,
  type RectLike,
} from '../../core/interaction/snap';

export class SelfInteractionAdapter implements InteractionAdapter {
  private targets: Element[] = [];
  private container: HTMLElement;
  private frame: HTMLElement | null;
  private dragCb: ((e: DragMoveEvent) => void) | null = null;

  // 拖拽会话状态
  private dragTarget: Element | null = null;
  private preTransform = '';
  private startX = 0;
  private startY = 0;
  private totalDx = 0;
  private totalDy = 0;
  private dragging = false;
  private rafId = 0;

  // T107 吸附状态
  private preRect: RectLike | null = null;
  private siblings: RectLike[] = [];
  private appliedDx = 0;
  private appliedDy = 0;
  private pendingDeltaX = 0;
  private pendingDeltaY = 0;
  private pendingGuides: Guide[] = [];
  private guideEls: HTMLDivElement[] = [];

  constructor(container: HTMLElement, frame: HTMLElement | null = null) {
    this.container = container;
    this.frame = frame;
  }

  /** 锁定谓词（T112）：返回 true 时该元素不启动拖拽。 */
  isLocked: (el: Element) => boolean = () => false;

  attach(els: Element[]): void {
    // 同一目标重复 attach 幂等返回，避免冒泡中重复 attach→detach 拆掉进行中的拖拽监听
    const same =
      els.length === this.targets.length && els.every((el, i) => el === this.targets[i]);
    if (same) return;
    this.detach();
    this.targets = els;
    if (els.length === 0) return;
    for (const el of els) {
      (el as HTMLElement).addEventListener('pointerdown', this.onPointerDown);
    }
  }

  detach(): void {
    for (const el of this.targets) {
      (el as HTMLElement).removeEventListener('pointerdown', this.onPointerDown);
    }
    this.targets = [];
    this.endDrag();
  }

  onDragMove(cb: (e: DragMoveEvent) => void): void {
    this.dragCb = cb;
  }

  onResize(_cb: (e: ResizeEvent) => void): void {
    /* T106 */
  }

  showGuides(guides: Guide[]): void {
    this.clearGuides();
    if (!this.frame) return;
    const frameRect = this.frame.getBoundingClientRect();
    const origin = this.container.getBoundingClientRect();
    for (const g of guides) {
      const line = document.createElement('div');
      line.dataset.guide = '1';
      line.style.position = 'absolute';
      line.style.background = 'rgba(66, 133, 244, 0.9)';
      line.style.zIndex = '25';
      line.style.pointerEvents = 'none';
      if (g.orientation === 'v') {
        line.style.width = '1px';
        line.style.height = '100%';
        line.style.left = `${g.position - frameRect.left - origin.left}px`;
        line.style.top = '0';
      } else {
        line.style.height = '1px';
        line.style.width = '100%';
        line.style.left = '0';
        line.style.top = `${g.position - frameRect.top - origin.top}px`;
      }
      this.container.appendChild(line);
      this.guideEls.push(line);
    }
  }

  clearGuides(): void {
    for (const l of this.guideEls) l.remove();
    this.guideEls = [];
  }

  /** 把被编辑 doc 内元素的 rect 换算成外层视口坐标。 */
  private outerRect(el: Element): RectLike {
    const frameRect = this.frame?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const fx = frameRect ? frameRect.left : 0;
    const fy = frameRect ? frameRect.top : 0;
    return {
      left: r.left + fx,
      right: r.right + fx,
      top: r.top + fy,
      bottom: r.bottom + fy,
      width: r.width,
      height: r.height,
    };
  }

  private onPointerDown = (e: PointerEvent): void => {
    const target = e.currentTarget as Element;
    if (this.isLocked(target)) return; // 锁定元素不启动拖拽
    const rect = target.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    if (!shouldStartDrag(target, localX, localY, rect)) return; // 内部文本让位于选字

    this.dragTarget = target;
    this.preTransform = (target as HTMLElement).style.transform || '';
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.totalDx = 0;
    this.totalDy = 0;
    this.dragging = false;
    this.appliedDx = 0;
    this.appliedDy = 0;
    this.pendingDeltaX = 0;
    this.pendingDeltaY = 0;
    this.pendingGuides = [];

    // T107：记录起始矩形与兄弟节点（外层视口坐标）
    this.preRect = this.outerRect(target);
    const parent = target.parentElement;
    this.siblings = parent
      ? Array.from(parent.children)
          .filter((c) => c !== target && c.nodeType === 1)
          .map((c) => this.outerRect(c))
      : [];

    const doc = target.ownerDocument;
    doc.addEventListener('pointermove', this.onPointerMove);
    doc.addEventListener('pointerup', this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragTarget || !this.preRect) return;
    let rawDx = e.clientX - this.startX;
    let rawDy = e.clientY - this.startY;

    // 死区：≤5px 抖动视为点击，不进入拖拽
    if (!this.dragging) {
      if (Math.abs(rawDx) <= INTERACTION.DRAG_DEAD_ZONE_PX && Math.abs(rawDy) <= INTERACTION.DRAG_DEAD_ZONE_PX) {
        return;
      }
      this.dragging = true;
    }

    // Shift 约束为较大分量的单轴
    if (e.shiftKey) {
      if (Math.abs(rawDx) >= Math.abs(rawDy)) rawDy = 0;
      else rawDx = 0;
    }

    // T107：目标矩形 = 起始矩形平移；临近兄弟边吸附，并叠加等距提示
    const pre = this.preRect;
    const targetRect: RectLike = {
      left: pre.left + rawDx,
      right: pre.right + rawDx,
      top: pre.top + rawDy,
      bottom: pre.bottom + rawDy,
      width: pre.width,
      height: pre.height,
    };
    const { guides, dx: snapDx, dy: snapDy } = computeEdgeGuides(targetRect, this.siblings);
    guides.push(...computeEqualSpacing([targetRect, ...this.siblings]));

    const finalDx = rawDx + snapDx;
    const finalDy = rawDy + snapDy;
    this.totalDx = finalDx;
    this.totalDy = finalDy;

    this.pendingDeltaX = finalDx - this.appliedDx;
    this.pendingDeltaY = finalDy - this.appliedDy;
    this.pendingGuides = guides;

    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (!this.dragTarget) return;
      applyTranslate(this.dragTarget, this.pendingDeltaX, this.pendingDeltaY);
      this.appliedDx += this.pendingDeltaX;
      this.appliedDy += this.pendingDeltaY;
      this.showGuides(this.pendingGuides);
    });
  };

  private onPointerUp = (): void => {
    if (!this.dragTarget) return;
    const target = this.dragTarget;
    const moved = this.dragging;
    const { totalDx, totalDy } = this;

    // 还原预览态，由 committed 回调 push 的 MoveCommand 干净地应用一次
    (target as HTMLElement).style.transform = this.preTransform;
    this.endDrag();
    this.clearGuides();

    if (moved) {
      this.dragCb?.({ dx: totalDx, dy: totalDy, committed: true });
    }
  };

  private endDrag(): void {
    if (this.dragTarget) {
      const doc = this.dragTarget.ownerDocument;
      doc.removeEventListener('pointermove', this.onPointerMove);
      doc.removeEventListener('pointerup', this.onPointerUp);
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.dragTarget = null;
    this.dragging = false;
  }
}
