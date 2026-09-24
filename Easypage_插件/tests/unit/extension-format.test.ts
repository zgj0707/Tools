// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { canApplyTextFormat, isFormatOn, setTextColor, toggleFormat } from '../../src/extension/format';
import { HistoryStackImpl } from '../../src/core/commands/HistoryStack';

/**
 * 这里只测**元素级**那条路径（happy-dom 没有可用的选区，`toggleViaSelection` 必然回落）。
 * 选区那条路径（包 `<strong>` / 再点一次解包）需要真实 Range 与 Selection，
 * 由 qa/probes/extension-p0-4.mjs 在真浏览器里验 —— 两边不重复。
 */

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function stack(): HistoryStackImpl {
  return new HistoryStackImpl();
}

describe('isFormatOn', () => {
  it('没设过内联样式 ⇒ 未开启（只读内联，不读计算样式）', () => {
    const el = mount('<p style="color:red">x</p>');
    expect(isFormatOn(el, 'bold')).toBe(false);
    expect(isFormatOn(el, 'italic')).toBe(false);
    expect(isFormatOn(el, 'underline')).toBe(false);
  });

  it('加粗：700 / bold / 800 都算开启，400 不算', () => {
    const el = mount('<p>x</p>');
    el.style.fontWeight = '700';
    expect(isFormatOn(el, 'bold')).toBe(true);
    el.style.fontWeight = 'bold';
    expect(isFormatOn(el, 'bold')).toBe(true);
    el.style.fontWeight = '800';
    expect(isFormatOn(el, 'bold')).toBe(true);
    el.style.fontWeight = '400';
    expect(isFormatOn(el, 'bold')).toBe(false);
  });

  it('倾斜：italic / oblique 算开启', () => {
    const el = mount('<p>x</p>');
    el.style.fontStyle = 'italic';
    expect(isFormatOn(el, 'italic')).toBe(true);
    el.style.fontStyle = 'oblique';
    expect(isFormatOn(el, 'italic')).toBe(true);
    el.style.fontStyle = 'normal';
    expect(isFormatOn(el, 'italic')).toBe(false);
  });

  it('下划线：多值也算（underline line-through）', () => {
    const el = mount('<p>x</p>');
    el.style.textDecorationLine = 'underline';
    expect(isFormatOn(el, 'underline')).toBe(true);
    el.style.textDecorationLine = 'underline line-through';
    expect(isFormatOn(el, 'underline')).toBe(true);
    el.style.textDecorationLine = 'line-through';
    expect(isFormatOn(el, 'underline')).toBe(false);
  });

  it('null 目标一律未开启', () => {
    expect(isFormatOn(null, 'bold')).toBe(false);
  });
});

describe('toggleFormat · 元素级 + 撤销往返', () => {
  it('开启：写入 700', () => {
    const el = mount('<p>x</p>');
    toggleFormat('bold', el, stack());
    expect(el.style.fontWeight).toBe('700');
    expect(isFormatOn(el, 'bold')).toBe(true);
  });

  it('再切一次关闭：清掉内联值（而不是写 400）', () => {
    const el = mount('<p>x</p>');
    const h = stack();
    toggleFormat('bold', el, h);
    toggleFormat('bold', el, h);
    expect(el.style.fontWeight).toBe('');
    expect(isFormatOn(el, 'bold')).toBe(false);
  });

  it('🔴 撤销要恢复**原值**，不是无脑清空', () => {
    const el = mount('<p>x</p>');
    el.style.fontWeight = '400'; // 页面本来就设过 400
    const h = stack();
    toggleFormat('bold', el, h);
    expect(el.style.fontWeight).toBe('700');
    h.undo();
    expect(el.style.fontWeight).toBe('400'); // 回到 400，而不是 ''
  });

  it('🔴 原本没设过时，撤销要**移除**内联属性', () => {
    const el = mount('<p>x</p>');
    const h = stack();
    toggleFormat('italic', el, h);
    expect(el.style.fontStyle).toBe('italic');
    h.undo();
    expect(el.style.fontStyle).toBe('');
  });

  it('撤销 → 重做 走一遍', () => {
    const el = mount('<p>x</p>');
    const h = stack();
    toggleFormat('underline', el, h);
    h.undo();
    expect(el.style.textDecorationLine).toBe('');
    h.redo();
    expect(el.style.textDecorationLine).toBe('underline');
  });

  it('未选中元素时是空操作，不炸', () => {
    const h = stack();
    expect(() => toggleFormat('bold', null, h)).not.toThrow();
    expect(h.canUndo()).toBe(false);
  });
});

describe('setTextColor', () => {
  it('设置并撤销回原色', () => {
    const el = mount('<p style="color: rgb(0, 0, 0)">x</p>');
    const h = stack();
    setTextColor(el, '#c0392b', h);
    expect(el.style.color).toBe('#c0392b');
    h.undo();
    expect(el.style.color).toBe('rgb(0, 0, 0)');
  });

  it('原本无颜色 ⇒ 撤销后移除', () => {
    const el = mount('<p>x</p>');
    const h = stack();
    setTextColor(el, '#1a7f37', h);
    expect(el.style.color).toBe('#1a7f37');
    h.undo();
    expect(el.style.color).toBe('');
  });
});

describe('canApplyTextFormat', () => {
  it('HTML 元素可格式化，null 与 SVG 元素不行', () => {
    const p = mount('<p>x</p>');
    expect(canApplyTextFormat(p)).toBe(true);
    expect(canApplyTextFormat(null)).toBe(false);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    expect(canApplyTextFormat(rect)).toBe(false);
  });
});
