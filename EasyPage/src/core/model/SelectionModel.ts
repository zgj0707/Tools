// 多选选择模型（T113）：select 替换集合，toggle 增删。

import type { SelectionModel as SelectionModelPort } from '../ports';

export class SelectionModel implements SelectionModelPort {
  private _elements: Element[] = [];
  private listeners = new Set<() => void>();

  get elements(): Element[] {
    return [...this._elements];
  }

  select(els: Element[]): void {
    this._elements = els.filter((e): e is Element => !!e);
    this.emit();
  }

  toggle(el: Element): void {
    const i = this._elements.indexOf(el);
    if (i >= 0) this._elements.splice(i, 1);
    else this._elements.push(el);
    this.emit();
  }

  clear(): void {
    this._elements = [];
    this.emit();
  }

  parentOf(el: Element): Element | null {
    return el.parentElement;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }
}
