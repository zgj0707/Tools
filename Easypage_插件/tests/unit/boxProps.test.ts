// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildShadow, inlineSizeValue, isKeepableZero, parsePx, parseShadow } from '../../src/core/style/boxProps';

describe('parseShadow', () => {
  it('解析四值+颜色', () => {
    const s = parseShadow('10px 5px 3px 2px red');
    expect(s).toEqual({ x: 10, y: 5, blur: 3, spread: 2, color: 'red' });
  });
  it('none/空 → null', () => {
    expect(parseShadow('none')).toBeNull();
    expect(parseShadow('')).toBeNull();
  });
  it('rgba 颜色', () => {
    const s = parseShadow('0px 0px 8px 0px rgba(0,0,0,0.3)');
    expect(s?.color).toBe('rgba(0,0,0,0.3)');
  });
});

describe('buildShadow', () => {
  it('拼装四值', () => {
    expect(buildShadow({ x: 1, y: 2, blur: 3, spread: 4, color: '#000' })).toBe('1px 2px 3px 4px #000');
  });
  it('null → 空串（移除内联）', () => {
    expect(buildShadow(null)).toBe('');
  });
});

describe('parsePx', () => {
  it('解析 px', () => {
    expect(parsePx('16px')).toBe(16);
  });
  it('非 px null', () => {
    expect(parsePx('50%')).toBeNull();
  });
});

describe('isKeepableZero', () => {
  it('margin/padding 0 保留', () => {
    expect(isKeepableZero('marginTop', '0px')).toBe(true);
  });
  it('border 0 不保留（应移除）', () => {
    expect(isKeepableZero('borderWidth', '0px')).toBe(false);
  });
});

describe('inlineSizeValue', () => {
  it('显式 px 返回数字', () => {
    expect(inlineSizeValue('300px')).toBe('300');
  });
  it('%/auto/calc/空 一律留空', () => {
    expect(inlineSizeValue('50%')).toBe('');
    expect(inlineSizeValue('auto')).toBe('');
    expect(inlineSizeValue('')).toBe('');
    expect(inlineSizeValue('calc(100% - 10px)')).toBe('');
  });
});
