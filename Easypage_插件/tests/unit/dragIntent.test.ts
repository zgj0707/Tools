// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { shouldStartDrag } from '../../src/core/interaction/dragIntent';
import { INTERACTION } from '../../src/constants';

function rect(w = 100, h = 100): DOMRect {
  return { width: w, height: h } as DOMRect;
}

describe('dragIntent', () => {
  const edge = INTERACTION.EDGE_HANDLE_PX;

  it('左边缘带可拖', () => {
    const el = document.createElement('div');
    el.textContent = '有字';
    expect(shouldStartDrag(el, edge - 1, 50, rect())).toBe(true);
  });

  it('右边缘带可拖', () => {
    const el = document.createElement('div');
    el.textContent = '有字';
    expect(shouldStartDrag(el, 100 - edge + 1, 50, rect())).toBe(true);
  });

  it('上下边缘带可拖', () => {
    const el = document.createElement('div');
    el.textContent = '有字';
    expect(shouldStartDrag(el, 50, 1, rect())).toBe(true);
    expect(shouldStartDrag(el, 50, 100 - 1, rect())).toBe(true);
  });

  it('内部有文本让位于选字（不可拖）', () => {
    const el = document.createElement('div');
    el.textContent = '有字';
    expect(shouldStartDrag(el, 50, 50, rect())).toBe(false);
  });

  it('内部无文本元素可拖', () => {
    const el = document.createElement('div');
    expect(shouldStartDrag(el, 50, 50, rect())).toBe(true);
  });
});
