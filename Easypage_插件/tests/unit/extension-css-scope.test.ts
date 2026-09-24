import { describe, expect, it } from 'vitest';
import { scopeCssToShadow } from '../../src/extension/host';

/**
 * `:root` → `:host` 的改写是插件样式的**唯一生命线**：
 * `:root` 在 shadow 树里不匹配任何元素，漏改的后果是「样式全丢但零报错」，
 * 只能靠肉眼走查发现。所以这条规则值得有单测兜住。
 */
describe('scopeCssToShadow', () => {
  it('行首的 :root 选择器改写为 :host', () => {
    expect(scopeCssToShadow(':root {')).toBe(':host {');
    expect(scopeCssToShadow(':root{')).toBe(':host{');
  });

  it('保留缩进（缩进后的 :root 同样要改）', () => {
    expect(scopeCssToShadow('    :root {')).toBe('    :host {');
  });

  it('支持 :root 作为选择器列表的一项', () => {
    expect(scopeCssToShadow(':root,\n:host {')).toBe(':host,\n:host {');
  });

  it('不动注释与属性值里出现的 :root', () => {
    const css = '/* 只有 :root 一层变量 */\n--x: ":root";\n:root { --a: 1 }';
    expect(scopeCssToShadow(css)).toBe('/* 只有 :root 一层变量 */\n--x: ":root";\n:host { --a: 1 }');
  });

  it('不误伤名字里含 root 的其他选择器', () => {
    const css = '.ep-root { color: red }';
    expect(scopeCssToShadow(css)).toBe(css);
  });

  it('真实 tokens.css 的取值能正确挂到 :host', () => {
    const css = '/* c */\n:root {\n  --ep-ink: #1f1f1e;\n}\n';
    expect(scopeCssToShadow(css)).toContain(':host {');
    expect(scopeCssToShadow(css)).toContain('--ep-ink: #1f1f1e;');
  });
});
