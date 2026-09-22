// 左侧元素面板（T111）：插入各类元素 + 删除选中。外壳 ep- 节点，不进被编辑文档。
import { KIND_LABELS, type ElementKind } from '../../../core/elements/factory';

export class ElementsPanel {
  readonly root: HTMLElement;
  private onInsertCb: ((kind: ElementKind) => void) | null = null;
  private onDeleteCb: (() => void) | null = null;
  private ulBtn!: HTMLButtonElement;
  private olBtn!: HTMLButtonElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.className = 'ep-elements';
    this.root.style.width = '160px';
    this.root.style.padding = '8px';
    this.root.style.borderRight = '1px solid #ddd';
    this.root.style.boxSizing = 'border-box';

    const title = document.createElement('h3');
    title.textContent = '插入';
    title.style.margin = '0 0 8px';
    this.root.appendChild(title);

    for (const kind of Object.keys(KIND_LABELS) as ElementKind[]) {
      const btn = document.createElement('button');
      btn.textContent = KIND_LABELS[kind];
      btn.style.cssText = 'display:block;width:100%;margin-bottom:4px;font-size:12px;';
      btn.addEventListener('click', () => this.onInsertCb?.(kind));
      this.root.appendChild(btn);
    }

    const del = document.createElement('button');
    del.textContent = '删除选中';
    del.style.cssText = 'display:block;width:100%;margin-top:8px;font-size:12px;';
    del.addEventListener('click', () => this.onDeleteCb?.());
    this.root.appendChild(del);

    this.ulBtn = document.createElement('button');
    this.ulBtn.textContent = '项目符号列表';
    this.ulBtn.style.cssText = 'display:block;width:100%;margin-top:8px;font-size:12px;';
    this.ulBtn.addEventListener('click', () => this.onListCb?.('ul'));
    this.root.appendChild(this.ulBtn);

    this.olBtn = document.createElement('button');
    this.olBtn.textContent = '编号列表';
    this.olBtn.style.cssText = 'display:block;width:100%;margin-top:4px;font-size:12px;';
    this.olBtn.addEventListener('click', () => this.onListCb?.('ol'));
    this.root.appendChild(this.olBtn);

    host.appendChild(this.root);
  }

  private onListCb: ((tag: 'ul' | 'ol') => void) | null = null;
  onList(cb: (tag: 'ul' | 'ol') => void): void {
    this.onListCb = cb;
  }
  setListButtons(ulEnabled: boolean, olEnabled: boolean, unwrapLabel: string): void {
    this.ulBtn.disabled = !ulEnabled;
    this.olBtn.disabled = !olEnabled;
    this.ulBtn.textContent = unwrapLabel === 'ul' ? '取消列表' : '项目符号列表';
    this.olBtn.textContent = unwrapLabel === 'ol' ? '取消列表' : '编号列表';
  }

  onInsert(cb: (kind: ElementKind) => void): void {
    this.onInsertCb = cb;
  }
  onDelete(cb: () => void): void {
    this.onDeleteCb = cb;
  }
}
