// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isResizable } from '../../src/core/interaction/resizeGuard';

describe('isResizable', () => {
  it('普通元素 inline px 宽高 → true', () => {
    const el = document.createElement('div');
    el.style.width = '120px';
    el.style.height = '80px';
    expect(isResizable(el).ok).toBe(true);
  });

  it('width:50% → false', () => {
    const el = document.createElement('div');
    el.style.width = '50%';
    el.style.height = '80px';
    expect(isResizable(el).ok).toBe(false);
  });

  it('auto / 空 → false', () => {
    const el = document.createElement('div');
    el.style.width = '';
    el.style.height = 'auto';
    expect(isResizable(el).ok).toBe(false);
  });

  it('img 替换元素 → true', () => {
    const img = document.createElement('img');
    img.getBoundingClientRect = () =>
      ({ width: 100, height: 100 }) as DOMRect;
    expect(isResizable(img).ok).toBe(true);
  });
});
