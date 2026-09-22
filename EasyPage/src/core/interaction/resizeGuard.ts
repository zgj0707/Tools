// 缩放能力守卫（T106 无损修复包）：判断元素能否安全按像素缩放。
// 保守 P0：普通元素仅当 inline width/height 均为显式 px 才可缩放；
// 替换媒体元素（img/canvas/video/svg/input/iframe）且当前具备确定像素尺寸才允许。

const PX_RE = /^-?\d*\.?\d+px$/i;
const REPLACEABLE = new Set(['IMG', 'CANVAS', 'VIDEO', 'SVG', 'INPUT', 'IFRAME']);

export interface ResizeGuardResult {
  ok: boolean;
  reasonKey?: string;
}

export function isResizable(el: Element): ResizeGuardResult {
  const html = el as HTMLElement;
  const w = html.style.width.trim();
  const h = html.style.height.trim();

  // 替换元素：需有确定像素渲染尺寸（getBoundingClientRect 非 0）
  if (REPLACEABLE.has(el.tagName)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { ok: true };
    return { ok: false, reasonKey: 'toast.resizeUnsupported' };
  }

  // 普通元素：inline width/height 都必须是显式 px
  if (PX_RE.test(w) && PX_RE.test(h)) return { ok: true };
  return { ok: false, reasonKey: 'toast.resizeUnsupported' };
}
