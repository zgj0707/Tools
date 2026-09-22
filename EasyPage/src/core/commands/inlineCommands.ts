import type { ICommand } from '../ports';
import { wrapTextNode, type InlineTag } from '../inline/wrapInline';

/**
 * 包裹/解包行内标签命令（节点级对称可逆，不重写 parent.textContent）。
 * wrap：execute 切分文本为 before/wrap/after 三节点；undo 移除三者，插回原完整文本节点。
 * unwrap：execute 用 createTextNode 替换 wrap 元素；undo 把原 wrap 元素插回原位。
 */
export class InlineWrapCommand implements ICommand {
  readonly name = 'inline-wrap';
  private readonly mode: 'wrap' | 'unwrap';
  // wrap 模式
  private textNode: Text | null = null;
  private startOffset = 0;
  private endOffset = 0;
  private tag: InlineTag = 'strong';
  private href?: string;
  private beforeNode: Text | null = null;
  private wrapEl: HTMLElement | null = null;
  private afterNode: Text | null = null;
  private fullText = '';
  private parent: Node | null = null;
  private anchorNext: Node | null = null;
  // unwrap 模式
  private wrapTarget: HTMLElement | null = null;
  private plain: Text | null = null;

  static wrap(textNode: Text, startOffset: number, endOffset: number, tag: InlineTag, href?: string): InlineWrapCommand {
    const c = new InlineWrapCommand('wrap');
    c.textNode = textNode;
    c.startOffset = startOffset;
    c.endOffset = endOffset;
    c.tag = tag;
    c.href = href;
    c.fullText = textNode.textContent ?? '';
    return c;
  }

  static unwrap(wrapEl: HTMLElement): InlineWrapCommand {
    const c = new InlineWrapCommand('unwrap');
    c.wrapTarget = wrapEl;
    return c;
  }

  private constructor(mode: 'wrap' | 'unwrap') {
    this.mode = mode;
  }

  execute(): void {
    if (this.mode === 'wrap') {
      this.doWrap();
    } else if (this.wrapTarget) {
      this.plain = this.wrapTarget.ownerDocument.createTextNode(this.wrapTarget.textContent ?? '');
      this.wrapTarget.parentNode!.replaceChild(this.plain, this.wrapTarget);
    }
  }

  undo(): void {
    if (this.mode === 'wrap') {
      this.undoWrap();
    } else if (this.wrapTarget && this.plain) {
      this.plain.parentNode!.replaceChild(this.wrapTarget, this.plain);
    }
  }

  redo(): void {
    this.execute();
  }

  private doWrap(): void {
    if (!this.textNode) return;
    this.wrapEl = wrapTextNode(this.textNode, this.startOffset, this.endOffset, this.tag, this.href);
    this.beforeNode = this.wrapEl.previousSibling as Text | null;
    this.afterNode = this.wrapEl.nextSibling as Text | null;
    if (this.beforeNode && this.beforeNode.nodeType !== 3) this.beforeNode = null;
    if (this.afterNode && this.afterNode.nodeType !== 3) this.afterNode = null;
    this.parent = this.wrapEl.parentNode;
    this.anchorNext = this.afterNode ? this.afterNode.nextSibling : this.wrapEl.nextSibling;
  }

  private undoWrap(): void {
    if (!this.wrapEl || !this.parent) return;
    const parent = this.parent;
    const doc = this.wrapEl.ownerDocument;
    if (this.beforeNode && this.beforeNode.parentNode === parent) parent.removeChild(this.beforeNode);
    parent.removeChild(this.wrapEl);
    if (this.afterNode && this.afterNode.parentNode === parent) parent.removeChild(this.afterNode);
    const restored = doc.createTextNode(this.fullText);
    const ref = this.anchorNext && this.anchorNext.parentNode === parent ? this.anchorNext : null;
    parent.insertBefore(restored, ref);
    this.textNode = restored;
  }
}
