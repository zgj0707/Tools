// 坐标换算纯函数（契约 01 §5）：
// 被选元素 getBoundingClientRect() 是相对 iframe 视口的；叠加 iframe 在外壳中的偏移即得覆盖层坐标。
// 覆盖层节点全部在外壳 #ep-overlay-root，绝不进入被编辑 doc。

export interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ScrollOffset {
  x: number;
  y: number;
}

/** 把 iframe 内元素 rect 换算成外壳（outer viewport）坐标。
 *  rect：元素在 iframe 视口内的 getBoundingClientRect()；
 *  frameRect：iframe 自身在外页的 getBoundingClientRect()；
 *  scroll：iframe 内容滚动补偿（getBoundingClientRect 已含内部滚动时传 0）。 */
export function frameToOverlay(
  rect: DOMRect,
  frameRect: DOMRect,
  scroll: ScrollOffset,
): OverlayBox {
  return {
    left: frameRect.left + rect.left + scroll.x,
    top: frameRect.top + rect.top + scroll.y,
    width: rect.width,
    height: rect.height,
  };
}

/** 取元素 getBoundingClientRect() 的薄封装（便于单测 mock）。 */
export function rectOf(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

/**
 * hover 高亮允许带填充的面积上限（占画布面积比例）。
 *
 * 12% 的强调色填充铺在按钮/标题这种小元素上是「高亮」，铺在整页/大分区上就是
 * 一层盖住全部内容的蓝蒙层 —— 用户称「蓝色框非常影响使用」（T123）。
 * 代价与收益的临界点取 1/4：小元素给填充（辨识嵌套层级），大容器只描边。
 */
export const HOVER_FILL_MAX_RATIO = 0.25;

/** hover 框是否该带填充：面积占比 ≤ 阈值才填。画布面积退化（0）时按不填充处理。 */
export function hoverFillAllowed(box: OverlayBox, frameRect: DOMRect): boolean {
  const canvasArea = frameRect.width * frameRect.height;
  if (!(canvasArea > 0)) return false;
  return (box.width * box.height) / canvasArea <= HOVER_FILL_MAX_RATIO;
}

/**
 * 是否为被编辑文档的根（html / body）。
 *
 * 根的框恒等于整页，悬停空白区时命中的就是它 —— 高亮它等于给整页套蓝框，
 * 所以 hover 阶段直接跳过（选中仍可走面包屑）。
 */
export function isDocumentRoot(el: Element): boolean {
  const doc = el.ownerDocument;
  return el === doc.documentElement || el === doc.body;
}

/** 轴对齐矩形严格相交（相切不算命中）。AABB 框选判定纯函数。 */
export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
