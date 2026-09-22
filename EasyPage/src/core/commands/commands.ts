// 内置命令（契约 01 §4）。
import type { ICommand } from '../ports';
import { applyTranslate } from '../interaction/transform';
import { buildList, unwrapList } from '../elements/list';

export class SetTextCommand implements ICommand {
  readonly name = 'set-text';
  readonly prev: string;
  readonly next: string;
  constructor(private readonly target: Element, next: string, prev: string) {
    this.next = next; this.prev = prev;
  }
  execute(): void { this.target.textContent = this.next; }
  undo(): void { this.target.textContent = this.prev; }
}

export class SetStyleCommand implements ICommand {
  readonly name = 'set-style';
  constructor(private readonly targets: Element[], private readonly props: Record<string, string>, private readonly prev: Map<Element, Record<string, string>>) {}
  execute(): void {
    for (const el of this.targets) {
      for (const [k, v] of Object.entries(this.props)) { ((el as HTMLElement).style as unknown as Record<string,string>)[k] = v; }
    }
  }
  undo(): void {
    for (const el of this.targets) {
      const old = this.prev.get(el); if (!old) continue;
      for (const k of Object.keys(this.props)) {
        const v = old[k];
        const hyphen = k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
        if (v === undefined) (el as HTMLElement).style.removeProperty(hyphen);
        else ((el as HTMLElement).style as unknown as Record<string,string>)[k] = v;
      }
    }
  }
}

export class SetAttributeCommand implements ICommand {
  readonly name = 'set-attribute';
  constructor(private readonly target: Element, private readonly attr: string, private readonly next: string | null, private readonly prev: string | null) {}
  execute(): void {
    if (this.next === null) this.target.removeAttribute(this.attr);
    else this.target.setAttribute(this.attr, this.next);
  }
  undo(): void {
    if (this.prev === null) this.target.removeAttribute(this.attr);
    else this.target.setAttribute(this.attr, this.prev);
  }
}

export class MoveCommand implements ICommand {
  readonly name = 'move';
  private prevTransforms = new Map<HTMLElement, string>();
  constructor(private readonly targets: Element[], private readonly dx: number, private readonly dy: number) {}
  execute(): void {
    for (const t of this.targets) { const el = t as HTMLElement; this.prevTransforms.set(el, el.style.transform); applyTranslate(el, this.dx, this.dy); }
  }
  undo(): void {
    for (const t of this.targets) { const el = t as HTMLElement; el.style.transform = this.prevTransforms.get(el) ?? ''; }
  }
}

export class ResizeCommand implements ICommand {
  readonly name = 'resize';
  constructor(private readonly targets: Element[], private readonly box: { width: number; height: number }, private readonly prev: { width: string | null; height: string | null }) {}
  execute(): void {
    for (const t of this.targets) { (t as HTMLElement).style.width = `${this.box.width}px`; (t as HTMLElement).style.height = `${this.box.height}px`; }
  }
  undo(): void {
    for (const t of this.targets) { const el = t as HTMLElement; el.style.width = this.prev.width ?? ''; el.style.height = this.prev.height ?? ''; }
  }
}

export class InsertNodeCommand implements ICommand {
  readonly name = 'insert-node';
  constructor(private readonly node: Node, private readonly parent: Element, private readonly index: number) {}
  execute(): void { const ref = this.parent.children[this.index] ?? null; this.parent.insertBefore(this.node, ref); }
  undo(): void { this.node.parentNode?.removeChild(this.node); }
}

export class RemoveNodeCommand implements ICommand {
  readonly name = 'remove-node';
  private parent: Element | null = null;
  private index = 0;
  constructor(private readonly node: Node) {}
  execute(): void {
    this.parent = this.node.parentElement;
    this.index = this.parent ? Array.from(this.parent.children).indexOf(this.node as Element) : 0;
    this.parent?.removeChild(this.node);
  }
  undo(): void { if (!this.parent) return; const ref = this.parent.children[this.index] ?? null; this.parent.insertBefore(this.node, ref); }
}

export class BatchCommand implements ICommand {
  readonly name: string;
  constructor(name: string, private readonly cmds: ICommand[]) { this.name = name; }
  execute(): void { for (const cmd of this.cmds) cmd.execute(); }
  undo(): void {
    for (let i = this.cmds.length - 1; i >= 0; i -= 1) { const c = this.cmds[i]; if (c) c.undo(); }
  }
}

export class WrapListCommand implements ICommand {
  readonly name = 'wrap-list';
  private list: Element | null = null;
  constructor(private readonly block: Element, private readonly tag: 'ul' | 'ol') {}
  execute(): void {
    const doc = this.block.ownerDocument;
    const parent = this.block.parentElement; if (!parent) return;
    if (!this.list) this.list = buildList(doc, this.block, this.tag);
    else { const li = this.list.firstElementChild; if (li) while (this.block.firstChild) li.appendChild(this.block.firstChild); }
    parent.replaceChild(this.list, this.block);
  }
  undo(): void {
    if (!this.list) return;
    const parent = this.list.parentElement; if (!parent) return;
    const li = this.list.firstElementChild; if (li) while (li.firstChild) this.block.appendChild(li.firstChild);
    const idx = Array.from(parent.children).indexOf(this.list);
    parent.replaceChild(this.block, this.list);
    parent.insertBefore(this.block, parent.children[idx] ?? null);
  }
}

export class UnwrapListCommand implements ICommand {
  readonly name = 'unwrap-list';
  private ps: Element[] | null = null;
  private index = 0;
  constructor(private readonly list: Element) {}
  execute(): void {
    const doc = this.list.ownerDocument;
    const parent = this.list.parentElement; if (!parent) return;
    if (!this.ps) this.ps = unwrapList(doc, this.list);
    this.index = Array.from(parent.children).indexOf(this.list);
    parent.removeChild(this.list);
    for (let i = 0; i < this.ps.length; i += 1) parent.insertBefore(this.ps[i] as Element, parent.children[this.index + i] ?? null);
  }
  undo(): void {
    if (!this.ps) return;
    const parent = this.ps[0]?.parentElement; if (!parent) return;
    for (const p of this.ps) p.parentNode?.removeChild(p);
    parent.insertBefore(this.list, parent.children[this.index] ?? null);
  }
}

export class ReorderNodeCommand implements ICommand {
  readonly name = 'reorder-node';
  constructor(private readonly node: Element, private readonly parent: Element, private readonly from: number, private readonly to: number) {}
  execute(): void {
    this.parent.removeChild(this.node);
    this.parent.insertBefore(this.node, Array.from(this.parent.children)[this.to] ?? null);
  }
  undo(): void {
    this.parent.removeChild(this.node);
    this.parent.insertBefore(this.node, Array.from(this.parent.children)[this.from] ?? null);
  }
}

export class SetDisplayCommand implements ICommand {
  readonly name = 'set-display';
  constructor(private readonly target: Element, private readonly next: string, private readonly prev: string) {}
  execute(): void { (this.target as HTMLElement).style.display = this.next; }
  undo(): void { (this.target as HTMLElement).style.display = this.prev; }
}
