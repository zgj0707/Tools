// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { assembleBorder, assemblePadding, assembleRadius, buildStyleProps, STYLE_WHITELIST } from '../../src/core/style/formatPaint';

describe('buildStyleProps', () => {
  it('键集合恰好等于白名单', () => {
    const props = buildStyleProps({
      color: 'red', backgroundColor: 'white', fontSize: '16px', fontWeight: '700',
      fontFamily: 'arial', fontStyle: 'italic', textDecoration: 'underline',
      textAlign: 'center', lineHeight: '1.5', letterSpacing: '1px',
      borderRadius: '4px', border: '1px solid black', boxShadow: 'none', opacity: '1',
      padding: '8px', textShadow: 'none',
    });
    expect(Object.keys(props).sort()).toEqual([...STYLE_WHITELIST].sort());
  });

  it('严禁布局/定位类属性', () => {
    const props = buildStyleProps({
      margin: '10px', width: '200px', top: '0', position: 'absolute',
      transform: 'translate(1px,0)', display: 'flex', float: 'left',
      color: 'red',
    } as Record<string, string>);
    expect(Object.keys(props)).toEqual(['color']);
    expect(props).not.toHaveProperty('margin');
    expect(props).not.toHaveProperty('width');
    expect(props).not.toHaveProperty('position');
    expect(props).not.toHaveProperty('transform');
  });
});

describe('assemblePadding', () => {
  it('四边相同归一单值', () => {
    expect(assemblePadding({ paddingTop: '11px', paddingRight: '11px', paddingBottom: '11px', paddingLeft: '11px' })).toBe('11px');
  });
  it('上下同、左右同归一两值', () => {
    expect(assemblePadding({ paddingTop: '5px', paddingRight: '10px', paddingBottom: '5px', paddingLeft: '10px' })).toBe('5px 10px');
  });
  it('全不同四值', () => {
    expect(assemblePadding({ paddingTop: '1px', paddingRight: '2px', paddingBottom: '3px', paddingLeft: '4px' })).toBe('1px 2px 3px 4px');
  });
});

describe('assembleRadius', () => {
  it('四角相同', () => {
    expect(assembleRadius({ borderTopLeftRadius: '9px', borderTopRightRadius: '9px', borderBottomRightRadius: '9px', borderBottomLeftRadius: '9px' })).toBe('9px');
  });
  it('对角相同两值', () => {
    expect(assembleRadius({ borderTopLeftRadius: '1px', borderTopRightRadius: '2px', borderBottomRightRadius: '1px', borderBottomLeftRadius: '2px' })).toBe('1px 2px');
  });
});

describe('assembleBorder', () => {
  it('拼简写', () => {
    expect(assembleBorder({ borderTopWidth: '3px', borderTopStyle: 'solid', borderTopColor: 'rgb(0, 0, 0)' })).toBe('3px solid rgb(0, 0, 0)');
  });
  it('none/0 宽返回 null（不收集）', () => {
    expect(assembleBorder({ borderTopWidth: '3px', borderTopStyle: 'none', borderTopColor: 'rgb(0,0,0)' })).toBeNull();
    expect(assembleBorder({ borderTopWidth: '0px', borderTopStyle: 'solid', borderTopColor: 'rgb(0,0,0)' })).toBeNull();
  });
});
