// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  computeEdgeGuides,
  computeEqualSpacing,
  type RectLike,
} from '../../src/core/interaction/snap';
import { INTERACTION } from '../../src/constants';

function r(left: number, top: number, width: number, height: number): RectLike {
  return { left, right: left + width, top, bottom: top + height, width, height };
}

describe('computeEdgeGuides', () => {
  it('左/右/水平中线 3 条垂直边正例', () => {
    const drag = r(100, 0, 50, 50);
    // 左对齐 sibling.left=100
    let g = computeEdgeGuides(drag, [r(100, 0, 50, 50)]);
    expect(g.guides.some((x) => x.orientation === 'v')).toBe(true);
    // 右对齐 sibling.right
    g = computeEdgeGuides(drag, [r(50, 0, 50, 50)]);
    expect(g.guides.some((x) => x.orientation === 'v')).toBe(true);
    // 水平中线对齐
    g = computeEdgeGuides(drag, [r(100, 10, 20, 30)]);
    expect(g.guides.some((x) => x.orientation === 'v')).toBe(true);
  });

  it('上/下/垂直中线 3 条水平边正例', () => {
    const drag = r(0, 100, 50, 50);
    let g = computeEdgeGuides(drag, [r(0, 100, 50, 50)]);
    expect(g.guides.some((x) => x.orientation === 'h')).toBe(true);
    g = computeEdgeGuides(drag, [r(0, 50, 50, 50)]);
    expect(g.guides.some((x) => x.orientation === 'h')).toBe(true);
    g = computeEdgeGuides(drag, [r(10, 100, 30, 20)]);
    expect(g.guides.some((x) => x.orientation === 'h')).toBe(true);
  });

  it('阈值边界：差=6 吸附，差=7 不吸附', () => {
    const T = INTERACTION.SNAP_THRESHOLD_PX;
    // 拖拽 left=100，兄弟 left=100+T → 差=T 应吸附
    const within = computeEdgeGuides(r(100, 0, 50, 50), [r(100 + T, 0, 50, 50)]);
    expect(within.guides.some((x) => x.orientation === 'v')).toBe(true);
    // 差=T+1 不吸附
    const beyond = computeEdgeGuides(r(100, 0, 50, 50), [r(100 + T + 1, 0, 50, 50)]);
    expect(beyond.guides.some((x) => x.orientation === 'v')).toBe(false);
  });
});

describe('computeEqualSpacing', () => {
  it('三元素等距正例', () => {
    // gap1 = 10, gap2 = 12，差 2 ≤ EQUAL_SPACE_PX(4)
    const guides = computeEqualSpacing([r(0, 0, 50, 50), r(60, 0, 50, 50), r(122, 0, 50, 50)]);
    expect(guides.length).toBeGreaterThan(0);
    expect(guides[0]?.label).toBeTruthy();
  });

  it('二元素反例（<3 无提示）', () => {
    const guides = computeEqualSpacing([r(0, 0, 50, 50), r(60, 0, 50, 50)]);
    expect(guides.length).toBe(0);
  });
});
