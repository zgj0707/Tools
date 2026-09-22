import { describe, expect, it } from 'vitest';
import { compute, type Box } from '../../src/core/layout/alignment';

const b = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });

describe('alignment.compute 六种对齐', () => {
  it('左对齐', () => {
    const r = compute([b(10, 0, 50, 50), b(30, 0, 60, 50), b(50, 0, 40, 50)], 'left');
    expect(r.map((d) => d.dx)).toEqual([0, -20, -40]);
  });
  it('右对齐', () => {
    const r = compute([b(0, 0, 50, 50), b(20, 0, 60, 50)], 'right');
    expect(r[0]!.dx).toBe(30);
    expect(r[1]!.dx).toBe(0);
  });
  it('水平居中', () => {
    const r = compute([b(0, 0, 100, 50), b(200, 0, 40, 50)], 'hcenter');
    expect(r[0]!.dx).toBe(70);
    expect(r[1]!.dx).toBe(-100);
  });
  it('顶/底对齐', () => {
    const r1 = compute([b(0, 10, 50, 30), b(0, 40, 50, 20)], 'top');
    expect(r1[0]!.dy).toBe(0);
    expect(r1[1]!.dy).toBe(-30);
    const r2 = compute([b(0, 0, 50, 30), b(0, 40, 50, 20)], 'bottom');
    expect(r2[0]!.dy).toBe(30);
    expect(r2[1]!.dy).toBe(0);
  });
});

describe('等距分布', () => {
  it('水平等距：首尾固定，中间偏移时移动到均分位置', () => {
    const r = compute([b(0, 0, 20, 20), b(50, 0, 20, 20), b(100, 0, 20, 20)], 'hdistribute');
    expect(r[0]!.dx).toBe(0);
    expect(r[1]!.dx).toBe(0);
    expect(r[2]!.dx).toBe(0);
  });
  it('垂直等距', () => {
    const r = compute([b(0, 0, 20, 20), b(0, 60, 20, 20), b(0, 100, 20, 20)], 'vdistribute');
    expect(r[0]!.dy).toBe(0);
    expect(r[1]!.dy).toBe(-10);
    expect(r[2]!.dy).toBe(0);
  });
  it('<3 元素不移动', () => {
    const r = compute([b(0, 0, 20, 20), b(50, 0, 20, 20)], 'hdistribute');
    expect(r[0]!.dx).toBe(0);
    expect(r[1]!.dx).toBe(0);
  });
});
describe('乱序输入：首尾固定、间隙相等', () => {
  it('hdistribute 输入顺序=[右,左,中]，不等宽', () => {
    // 左 left=0 w=10, 中 left=50 w=20, 右 left=100 w=30
    // 输入顺序：[右(100,30), 左(0,10), 中(50,20)]
    const boxes = [
      { left: 100, top: 0, width: 30, height: 10 },
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 50, top: 0, width: 20, height: 10 },
    ];
    const r = compute(boxes, 'hdistribute');
    // 排序后：左(idx1), 中(idx2), 右(idx0)。span=100, 前两项宽和=10+20=30, gap=35
    expect(r[1]!.dx).toBe(0); // 左不动
    expect(r[0]!.dx).toBe(0); // 右不动
    expect(r[2]!.dx).toBe(-5); // 中从 50 到 45
  });
  it('vdistribute 乱序不等高', () => {
    const boxes = [
      { left: 0, top: 100, width: 10, height: 30 },
      { left: 0, top: 0, width: 10, height: 10 },
      { left: 0, top: 50, width: 10, height: 20 },
    ];
    const r = compute(boxes, 'vdistribute');
    expect(r[1]!.dy).toBe(0);
    expect(r[0]!.dy).toBe(0);
    expect(r[2]!.dy).toBe(-5);
  });
});
