// 对齐吸附与等距提示纯函数（契约 01 §4 Guide；T107）。
// 只做临近吸附（差 ≤ SNAP_THRESHOLD_PX）与 ≥3 元素等距提示，不做自动布局。

import { INTERACTION } from '../../constants';
import type { Guide } from '../ports';

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SnapResult {
  guides: Guide[];
  dx: number;
  dy: number;
}

/** 取垂直边（left/right/水平中线） */
function vEdges(r: RectLike): number[] {
  return [r.left, r.right, r.left + r.width / 2];
}

/** 取水平边（top/bottom/垂直中线） */
function hEdges(r: RectLike): number[] {
  return [r.top, r.bottom, r.top + r.height / 2];
}

/** 在一个轴上找最近的吸附边；返回需要叠加到指针位移的 delta 与 Guide 位置。 */
function scanAxis(
  dragEdges: number[],
  sibEdges: number[],
  threshold: number,
): { delta: number; position: number } | null {
  let best: { delta: number; position: number } | null = null;
  for (const de of dragEdges) {
    for (const se of sibEdges) {
      const delta = se - de;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, position: se };
      }
    }
  }
  return best;
}

/**
 * 计算拖拽矩形相对兄弟节点的吸附。
 * 返回 Guide 列表（外层视口坐标）与需要叠加到指针位移上的吸附 delta。
 */
export function computeEdgeGuides(drag: RectLike, siblings: RectLike[]): SnapResult {
  const threshold = INTERACTION.SNAP_THRESHOLD_PX;
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;

  const dragV = vEdges(drag);
  const dragH = hEdges(drag);
  const sibV: number[] = [];
  const sibH: number[] = [];
  for (const s of siblings) {
    sibV.push(...vEdges(s));
    sibH.push(...hEdges(s));
  }

  const v = scanAxis(dragV, sibV, threshold);
  if (v) {
    dx = v.delta;
    guides.push({ orientation: 'v', position: v.position });
  }
  const h = scanAxis(dragH, sibH, threshold);
  if (h) {
    dy = h.delta;
    guides.push({ orientation: 'h', position: h.position });
  }

  return { guides, dx, dy };
}

/**
 * 同层级 ≥3 元素按左边排序后，相邻间距在 EQUAL_SPACE_PX 内相等时返回等距提示 Guide。
 */
export function computeEqualSpacing(rects: RectLike[]): Guide[] {
  const threshold = INTERACTION.EQUAL_SPACE_PX;
  if (rects.length < 3) return [];
  const sorted = [...rects].sort((a, b) => a.left - b.left);
  const guides: Guide[] = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    const gap1 = cur.left - prev.right;
    const gap2 = next.left - cur.right;
    if (Math.abs(gap1 - gap2) <= threshold) {
      const gap = Math.round((gap1 + gap2) / 2);
      // 蓝色双箭头位置：中间元素左边
      guides.push({ orientation: 'v', position: cur.left, label: `${gap}px` });
    }
  }
  return guides;
}
