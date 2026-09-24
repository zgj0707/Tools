// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { InlineTextEditor } from '../../src/app/canvas/InlineTextEditor';
import { EP } from '../../src/constants';

function makeH1(text: string): HTMLElement {
  const h1 = document.createElement('h1');
  h1.textContent = text;
  document.body.appendChild(h1);
  return h1;
}

describe('InlineTextEditor', () => {
  it('start 后加 contenteditable 与 data-ep-editing', () => {
    const el = makeH1('原始');
    const editor = new InlineTextEditor(() => {});
    editor.start(el);
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(el.getAttribute(EP.EDITING_ATTR)).toBe('true');
    expect(editor.isEditing()).toBe(true);
  });

  it('commit 后移除两个标记，且变化时触发回调', () => {
    const el = makeH1('原始');
    const cb = vi.fn();
    const editor = new InlineTextEditor(cb);
    editor.start(el);
    el.textContent = '改后';
    const ret = editor.commit();
    expect(ret).toBe('改后');
    expect(el.getAttribute('contenteditable')).toBeNull();
    expect(el.getAttribute(EP.EDITING_ATTR)).toBeNull();
    expect(cb).toHaveBeenCalledWith(el, '改后', '原始');
    expect(editor.isEditing()).toBe(false);
  });

  it('无变化 commit 返回 null，不触发回调', () => {
    const el = makeH1('原样');
    const cb = vi.fn();
    const editor = new InlineTextEditor(cb);
    editor.start(el);
    const ret = editor.commit();
    expect(ret).toBeNull();
    expect(cb).not.toHaveBeenCalled();
  });

  it('Esc 取消还原原文本', () => {
    const el = makeH1('原始');
    const editor = new InlineTextEditor(() => {});
    editor.start(el);
    el.textContent = '中途改动';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(el.textContent).toBe('原始');
    expect(el.getAttribute('contenteditable')).toBeNull();
    expect(editor.isEditing()).toBe(false);
  });

  it('Enter 提交且不产生新 <div>', () => {
    const el = makeH1('第一行');
    const editor = new InlineTextEditor(() => {});
    editor.start(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Enter 提交后退出编辑态
    expect(editor.isEditing()).toBe(false);
    expect(el.querySelector('div')).toBeNull();
  });
});
