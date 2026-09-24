// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { commonValue, diffProps, parseLineHeight, parsePx } from '../../src/core/style/textProps';

describe('commonValue', () => {
  it('全部相同返回该值', () => {
    expect(commonValue(['16px', '16px', '16px'])).toBe('16px');
  });
  it('不一致返回 null（混合）', () => {
    expect(commonValue(['16px', '18px'])).toBeNull();
  });
  it('空数组返回 null', () => {
    expect(commonValue([])).toBeNull();
  });
});

describe('parsePx', () => {
  it('解析 px 数值', () => {
    expect(parsePx('16px')).toBe(16);
    expect(parsePx('24.5px')).toBe(24.5);
  });
  it('非 px 返回 null', () => {
    expect(parsePx('50%')).toBeNull();
    expect(parsePx('auto')).toBeNull();
  });
});

describe('parseLineHeight', () => {
  it('normal 返回 null', () => {
    expect(parseLineHeight('normal')).toBeNull();
  });
  it('无单位倍数返回数值', () => {
    expect(parseLineHeight('1.5')).toBe(1.5);
  });
  it('px 返回数值', () => {
    expect(parseLineHeight('24px')).toBe(24);
  });
});

describe('diffProps', () => {
  it('只返回变化项', () => {
    const initial = { color: 'black', fontSize: '16px' };
    const next = { color: 'black', fontSize: '18px' };
    expect(diffProps(initial, next)).toEqual({ fontSize: '18px' });
  });
  it('无变化返回空对象', () => {
    const initial = { color: 'black' };
    expect(diffProps(initial, { color: 'black' })).toEqual({});
  });
});
