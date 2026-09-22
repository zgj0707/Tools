// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { frameToOverlay, rectsIntersect, type OverlayBox } from '../../src/app/canvas/geom';

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
