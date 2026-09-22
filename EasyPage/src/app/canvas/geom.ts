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

/** 轴对齐矩形严格相交（相切不算命中）。AABB 框选判定纯函数。 */
export function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
