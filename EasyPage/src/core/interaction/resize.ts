// 8 向缩放计算纯函数（契约 01 §4 ResizeEvent；T106）。
// P0 简化规则：水平手柄改 width、垂直手柄改 height、角手柄同时改；结果钳制 ≥ MIN_BOX_PX。
// Shift 在角手柄上等比（按较大变化比例）。

import { INTERACTION } from '../../constants';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizeStartSize {
  width: number;
  height: number;
}

export function computeResize(
  direction: ResizeDirection,
  start: ResizeStartSize,
  dx: number,
  dy: number,
  shiftKey = false,
): ResizeStartSize {
  let w = start.width;
  let h = start.height;

  switch (direction) {
    case 'e':
      w = start.width + dx;
      break;
    case 'w':
      w = start.width - dx;
      break;
    case 's':
      h = start.height + dy;
      break;
    case 'n':
      h = start.height - dy;
      break;
    case 'se':
      w = start.width + dx;
      h = start.height + dy;
      break;
    case 'sw':
      w = start.width - dx;
      h = start.height + dy;
      break;
    case 'ne':
      w = start.width + dx;
      h = start.height - dy;
      break;
    case 'nw':
      w = start.width - dx;
      h = start.height - dy;
      break;
  }

  // 角手柄 + Shift：等比，按较大变化比例
  if (shiftKey && direction.length === 2) {
    const ratio = Math.max(Math.abs(w) / start.width, Math.abs(h) / start.height);
    w = start.width * ratio;
    h = start.height * ratio;
  }

  const MIN = INTERACTION.MIN_BOX_PX;
  return {
    width: Math.max(MIN, Math.round(w)),
    height: Math.max(MIN, Math.round(h)),
  };
}
