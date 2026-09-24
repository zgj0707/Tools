// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyTranslate, clearTranslate, parseTranslate } from '../../src/core/interaction/transform';

describe('transform', () => {
  it('初始无 transform 解析为 0,0', () => {
    const el = document.createElement('div');
    expect(parseTranslate(el)).toEqual({ x: 0, y: 0 });
  });

  it('applyTranslate 累加写回', () => {
    const el = document.createElement('div');
    applyTranslate(el, 10, 20);
    expect(el.style.transform).toBe('translate(10px, 20px)');
    applyTranslate(el, 5, 3);
    expect(el.style.transform).toBe('translate(15px, 23px)');
    expect(parseTranslate(el)).toEqual({ x: 15, y: 23 });
  });

  it('保留 scale/rotate 分量', () => {
    const el = document.createElement('div');
    el.style.transform = 'scale(2) rotate(45deg)';
    applyTranslate(el, 4, 6);
    expect(el.style.transform).toContain('scale(2)');
    expect(el.style.transform).toContain('rotate(45deg)');
    expect(parseTranslate(el)).toEqual({ x: 4, y: 6 });
  });

  it('clearTranslate 清除 translate 保留其他', () => {
    const el = document.createElement('div');
    el.style.transform = 'scale(2) translate(10px, 20px)';
    clearTranslate(el);
    expect(el.style.transform).toBe('scale(2)');
    expect(parseTranslate(el)).toEqual({ x: 0, y: 0 });
  });
});
