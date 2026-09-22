// 就地文本编辑（契约 01 §4 InlineTextEditor）：
// 双击进入 contenteditable 就地改字，统一 Enter 提交 / Shift+Enter 换行 / Esc 取消 / Tab 退出。
// 临时标记 contenteditable 与 data-ep-editing 提交即删，导出无残留。

import { EP } from '../../constants';
import type { InlineTextEditor as InlineTextEditorPort } from '../../core/ports';

const TEXT_WHITELIST = new Set([
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'P',
  'SPAN',
  'A',
  'BUTTON',
  'LI',
]);

/** 判断元素是否属于可双击改字的文本类白名单。 */
export function isEditableTextElement(el: Element): boolean {
  return TEXT_WHITELIST.has(el.tagName.toUpperCase());
}

/** start 提交后回调：(元素, 最终文本, 原始文本)，由外壳包装成 SetTextCommand 入历史。 */
export type InlineCommitHandler = (el: Element, next: string, prev: string) => void;

function placeCaretAtEnd(el: HTMLElement): void {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = win.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

export class InlineTextEditor implements InlineTextEditorPort {
  private el: HTMLElement | null = null;
  private prevText = '';
  private onKeydown: ((e: KeyboardEvent) => void) | null = null;
  private onPaste: ((e: ClipboardEvent) => void) | null = null;
  private onBlur: (() => void) | null = null;

  constructor(private readonly commitHandler: InlineCommitHandler) {}

  start(el: Element): void {
    if (!isEditableTextElement(el)) return;
    const htmlEl = el as HTMLElement;
    if (this.el === htmlEl) return; // 已在编辑同一元素
    // 同一时刻只允许一个编辑态：先提交上一个
    if (this.el) this.commit();

    this.el = htmlEl;
    this.prevText = htmlEl.textContent ?? '';

    htmlEl.setAttribute('contenteditable', 'true');
    htmlEl.setAttribute(EP.EDITING_ATTR, 'true');
    htmlEl.focus();
    placeCaretAtEnd(htmlEl);

    this.onKeydown = (e: KeyboardEvent) => this.handleKeydown(e);
    this.onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      htmlEl.ownerDocument.execCommand('insertText', false, text);
    };
    this.onBlur = () => this.commit();

    htmlEl.addEventListener('keydown', this.onKeydown);
    htmlEl.addEventListener('paste', this.onPaste);
    htmlEl.addEventListener('blur', this.onBlur);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.el) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      // 提交
      e.preventDefault();
      this.commit();
    } else if (e.key === 'Enter') {
      // Shift+Enter：元素内换行，不造新 <div>
      e.preventDefault();
      this.el.ownerDocument.execCommand('insertLineBreak', false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    } else if (e.key === 'Tab') {
      // 退出编辑（blur → commit）
      e.preventDefault();
      this.el.blur();
    }
  }

  commit(): string | null {
    if (!this.el) return null;
    const el = this.el;
    const next = el.textContent ?? '';
    this.detach(el);
    el.removeAttribute('contenteditable');
    el.removeAttribute(EP.EDITING_ATTR);
    this.el = null;
    if (next !== this.prevText) {
      this.commitHandler(el, next, this.prevText);
      return next;
    }
    return null;
  }

  cancel(): void {
    if (!this.el) return;
    const el = this.el;
    this.detach(el);
    el.textContent = this.prevText;
    el.removeAttribute('contenteditable');
    el.removeAttribute(EP.EDITING_ATTR);
    this.el = null;
  }

  isEditing(): boolean {
    return this.el !== null;
  }

  getEditingEl(): Element | null {
    return this.el;
  }

  private detach(el: HTMLElement): void {
    if (this.onKeydown) el.removeEventListener('keydown', this.onKeydown);
    if (this.onPaste) el.removeEventListener('paste', this.onPaste);
    if (this.onBlur) el.removeEventListener('blur', this.onBlur);
    this.onKeydown = null;
    this.onPaste = null;
    this.onBlur = null;
  }
}
