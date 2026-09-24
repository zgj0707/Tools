// 对齐/分布纯函数（T113）：输入各元素当前视觉矩形，返回每个元素需要的 dx/dy。
// 不依赖 DOM，调用方用 getBoundingClientRect 提供。

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AlignType =
  | 'left' | 'right' | 'hcenter'
  | 'top' | 'bottom' | 'vcenter'
  | 'hdistribute' | 'vdistribute';

export interface Delta { dx: number; dy: number }

export function compute(boxes: Box[], type: AlignType): Delta[] {
  if (boxes.length === 0) return [];
  const result: Delta[] = boxes.map(() => ({ dx: 0, dy: 0 }));

  if (type === 'hdistribute') {
    if (boxes.length < 3) return result;
    const sorted = boxes.map((b, i) => ({ b, i })).sort((a, c) => a.b.left - c.b.left);
    const first = sorted[0]!.b;
    const last = sorted[sorted.length - 1]!.b;
    const span = last.left - first.left;
    const middleW = sorted.slice(0, -1).reduce((s, { b }) => s + b.width, 0);
    const gap = (span - middleW) / (boxes.length - 1);
    let cursor = first.left;
    for (const { b, i } of sorted) {
      result[i]!.dx = cursor - b.left;
      cursor += b.width + gap;
    }
    return result;
  }
  if (type === 'vdistribute') {
    if (boxes.length < 3) return result;
    const sorted = boxes.map((b, i) => ({ b, i })).sort((a, c) => a.b.top - c.b.top);
    const first = sorted[0]!.b;
    const last = sorted[sorted.length - 1]!.b;
    const span = last.top - first.top;
    const middleH = sorted.slice(0, -1).reduce((s, { b }) => s + b.height, 0);
    const gap = (span - middleH) / (boxes.length - 1);
    let cursor = first.top;
    for (const { b, i } of sorted) {
      result[i]!.dy = cursor - b.top;
      cursor += b.height + gap;
    }
    return result;
  }

  const minLeft = Math.min(...boxes.map((b) => b.left));
  const maxRight = Math.max(...boxes.map((b) => b.left + b.width));
  const minTop = Math.min(...boxes.map((b) => b.top));
  const maxBottom = Math.max(...boxes.map((b) => b.top + b.height));

  boxes.forEach((b, i) => {
    switch (type) {
      case 'left': result[i]!.dx = minLeft - b.left; break;
      case 'right': result[i]!.dx = maxRight - (b.left + b.width); break;
      case 'hcenter': result[i]!.dx = (minLeft + maxRight) / 2 - (b.left + b.width / 2); break;
      case 'top': result[i]!.dy = minTop - b.top; break;
      case 'bottom': result[i]!.dy = maxBottom - (b.top + b.height); break;
      case 'vcenter': result[i]!.dy = (minTop + maxBottom) / 2 - (b.top + b.height / 2); break;
    }
  });
  return result;
}
