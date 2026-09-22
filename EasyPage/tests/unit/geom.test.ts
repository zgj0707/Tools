// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { frameToOverlay, hoverFillAllowed, isDocumentRoot, rectsIntersect, type OverlayBox } from '../../src/app/canvas/geom';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height } as DOMRect;
}

describe('frameToOverlay', () => {
  it('叠加 iframe 偏移与滚动，输出覆盖层坐标', () => {
    const rect = makeRect(10, 20, 100, 50);
    const frameRect = makeRect(5, 100, 800, 600);
    const out = frameToOverlay(rect, frameRect, { x: 0, y: 0 });
    expect(out).toEqual<OverlayBox>({ left: 15, top: 120, width: 100, height: 50 });
  });

  it('滚动补偿叠加到 left/top', () => {
    const rect = makeRect(10, 20, 100, 50);
    const frameRect = makeRect(5, 100, 800, 600);
    const out = frameToOverlay(rect, frameRect, { x: 7, y: 9 });
    expect(out.left).toBe(22);
    expect(out.top).toBe(129);
  });

  it('宽高透传元素自身尺寸', () => {
    const rect = makeRect(0, 0, 320, 240);
    const frameRect = makeRect(0, 0, 800, 600);
    const out = frameToOverlay(rect, frameRect, { x: 0, y: 0 });
    expect(out.width).toBe(320);
    expect(out.height).toBe(240);
  });
});

describe('rectsIntersect', () => {
  it('明显相交命中', () => {
    expect(rectsIntersect({left:0,top:0,right:10,bottom:10}, {left:5,top:5,right:15,bottom:15})).toBe(true);
  });
  it('完全分离不命中', () => {
    expect(rectsIntersect({left:0,top:0,right:10,bottom:10}, {left:20,top:20,right:30,bottom:30})).toBe(false);
  });
  it('包含关系命中', () => {
    expect(rectsIntersect({left:0,top:0,right:100,bottom:100}, {left:10,top:10,right:20,bottom:20})).toBe(true);
  });
  it('仅边相切不命中', () => {
    expect(rectsIntersect({left:0,top:0,right:10,bottom:10}, {left:10,top:0,right:20,bottom:10})).toBe(false);
  });
  it('零面积框选矩形不命中', () => {
    expect(rectsIntersect({left:0,top:0,right:0,bottom:0}, {left:0,top:0,right:10,bottom:10})).toBe(false);
  });
});

// T123：整页蓝框回归。画布 1000×500，阈值 1/4（125000）。
describe('hoverFillAllowed', () => {
  const canvas = makeRect(0, 0, 1000, 500);
  const box = (w: number, h: number): OverlayBox => ({ left: 0, top: 0, width: w, height: h });

  it('小元素（段落）允许填充', () => {
    expect(hoverFillAllowed(box(1000, 30), canvas)).toBe(true);
  });

  it('恰好等于阈值仍允许填充', () => {
    // 500×250 = 125000 = 25%
    expect(hoverFillAllowed(box(500, 250), canvas)).toBe(true);
  });

  it('超过阈值（大容器的 42%）不给填充', () => {
    // 1000×256 = 256000 ≈ 51%
    expect(hoverFillAllowed(box(1000, 256), canvas)).toBe(false);
  });

  it('整页大小的框不给填充', () => {
    expect(hoverFillAllowed(box(1000, 500), canvas)).toBe(false);
  });

  it('画布面积退化为 0 时不给填充（避免除零产生 Infinity）', () => {
    expect(hoverFillAllowed(box(10, 10), makeRect(0, 0, 0, 0))).toBe(false);
  });
});

describe('isDocumentRoot', () => {
  it('body 与 documentElement 判为根', () => {
    expect(isDocumentRoot(document.body)).toBe(true);
    expect(isDocumentRoot(document.documentElement)).toBe(true);
  });

  it('普通元素不判为根', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(isDocumentRoot(div)).toBe(false);
    div.remove();
  });
});
