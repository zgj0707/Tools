// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { computeResize } from '../../src/core/interaction/resize';
import { INTERACTION } from '../../src/constants';

const start = { width: 100, height: 100 };

describe('computeResize', () => {
  it('8 方向符号正确', () => {
    expect(computeResize('e', start, 30, 0)).toEqual({ width: 130, height: 100 });
    expect(computeResize('w', start, 30, 0)).toEqual({ width: 70, height: 100 });
    expect(computeResize('s', start, 0, 40)).toEqual({ width: 100, height: 140 });
    expect(computeResize('n', start, 0, 40)).toEqual({ width: 100, height: 60 });
    expect(computeResize('se', start, 30, 40)).toEqual({ width: 130, height: 140 });
    expect(computeResize('sw', start, 30, 40)).toEqual({ width: 70, height: 140 });
    expect(computeResize('ne', start, 30, 40)).toEqual({ width: 130, height: 60 });
    expect(computeResize('nw', start, 30, 40)).toEqual({ width: 70, height: 60 });
  });

  it('缩小到小于 MIN_BOX_PX 被钳制', () => {
    const MIN = INTERACTION.MIN_BOX_PX;
    const r = computeResize('w', start, 200, 0);
    expect(r.width).toBe(MIN);
    expect(computeResize('n', start, 0, 200).height).toBe(MIN);
  });

  it('Shift 在角手柄上等比', () => {
    const r = computeResize('se', start, 200, 100, true);
    // 比例取较大：width 变 300/100=3，height 变 200/100=2，取 3 → 300,300
    expect(r.width).toBe(300);
    expect(r.height).toBe(300);
  });

  it('Shift 只对角手柄生效，边手柄不受影响', () => {
    const r = computeResize('e', start, 30, 0, true);
    expect(r).toEqual({ width: 130, height: 100 });
  });
});
