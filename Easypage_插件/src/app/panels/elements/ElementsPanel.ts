// 左侧元素面板（T111）：插入各类元素 + 删除选中。外壳 ep- 节点，不进被编辑文档。
// 文案一律走 i18n（契约 01 §3/§9），不在此硬编码中文。
import { t } from '../../i18n/zh-CN';
import { KIND_LABELS, type ElementKind } from '../../../core/elements/factory';

export class ElementsPanel {
  readonly root: HTMLElement;
  private onInsertCb: ((kind: ElementKind) => void) | null = null;
  private onDeleteCb: (() => void) | null = null;
  private ulBtn!: HTMLButtonElement;
  private olBtn!: HTMLButtonElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement('aside');
    // 宽度 / 内边距 / 分隔线由 style/app.css 的 .ep-elements 承担
    this.root.className = 'ep-elements';

    const title = document.createElement('h3');
    title.textContent = t('panel.elements.title');
    this.root.appendChild(title);

    for (const kind of Object.keys(KIND_LABELS) as ElementKind[]) {
      const btn = document.createElement('button');
      btn.className = 'ep-btn ep-btn--block';
      btn.textContent = KIND_LABELS[kind];
      btn.addEventListener('click', () => this.onInsertCb?.(kind));
      this.root.appendChild(btn);
    }

    const del = document.createElement('button');
    del.className = 'ep-btn ep-btn--block ep-btn--danger';
    del.textContent = t('panel.elements.delete');
    del.addEventListener('click', () => this.onDeleteCb?.());
    this.root.appendChild(del);

    this.ulBtn = document.createElement('button');
    this.ulBtn.className = 'ep-btn ep-btn--block';
    this.ulBtn.textContent = t('panel.elements.ul');
    this.ulBtn.addEventListener('click', () => this.onListCb?.('ul'));
    this.root.appendChild(this.ulBtn);

    this.olBtn = document.createElement('button');
    this.olBtn.className = 'ep-btn ep-btn--block';
    this.olBtn.textContent = t('panel.elements.ol');
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
    // unwrapLabel === 'ul' 表示当前为 ul、按钮转为「取消列表」
    this.ulBtn.textContent = unwrapLabel === 'ul' ? t('panel.style.unlist') : t('panel.elements.ul');
    this.olBtn.textContent = unwrapLabel === 'ol' ? t('panel.style.unlist') : t('panel.elements.ol');
  }

  onInsert(cb: (kind: ElementKind) => void): void {
    this.onInsertCb = cb;
  }
  onDelete(cb: () => void): void {
    this.onDeleteCb = cb;
  }
}
