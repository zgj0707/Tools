// 图层面板（T112）：body 顺序可折叠树 + 锁定/显隐/排序 + 懒渲染。外壳 ep- 节点。

import { collectRows, ancestorChain, type LayerRow } from './tree';

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return `${tag}${id}${cls ? '.' + cls : ''}`;
}

export interface LayersHooks {
  select(el: Element): void;
  toggleLock(el: Element): void;
  toggleHide(el: Element): void;
  reorder(el: Element, dir: -1 | 1 | 'top' | 'bottom'): void;
}

const PER_NODE_LIMIT = 200;

export class LayersPanel {
  readonly root: HTMLElement;
  private listEl!: HTMLElement;
  private hooks!: LayersHooks;
  private selected: Element | null = null;
  private expanded = new Set<Element>();
  private overrides = new Map<Element, number>();
  private lastAutoExpanded: Element | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.className = 'ep-layers';
    this.root.style.cssText = 'width:200px;padding:8px;border-right:1px solid #ddd;box-sizing:border-box;overflow:auto;max-height:600px;';
    const title = document.createElement('h3');
    title.textContent = '图层';
    title.style.margin = '0 0 8px';
    this.root.appendChild(title);
    this.listEl = document.createElement('div');
    this.listEl.className = 'ep-layer-list';
    this.root.appendChild(this.listEl);
    host.appendChild(this.root);
  }

  setHooks(h: LayersHooks): void {
    this.hooks = h;
  }

  render(doc: Document, lock: { isLocked(e: Element): boolean }): void {
    this.listEl.textContent = '';
    const body = doc.body;
    if (!body) return;
    // 默认全展开
    if (this.expanded.size === 0) {
      const init = (el: Element) => {
        if (el.children.length > 0) this.expanded.add(el);
        for (const c of Array.from(el.children)) init(c);
      };
      init(body);
    }
    const truncated: Array<[Element, number, number]> = [];
    const rows = collectRows(doc, {
      expanded: this.expanded,
      perNodeLimit: PER_NODE_LIMIT,
      limitFor: (el) => this.overrides.get(el) ?? PER_NODE_LIMIT,
      onTruncated: (parent, n) => truncated.push([parent, n, this.overrides.get(parent) ?? PER_NODE_LIMIT]),
    });
    for (const row of rows) this.appendRow(row, lock);
    for (const [parent, n, shown] of truncated) this.appendMore(parent, n, shown);
  }

  private appendMore(parent: Element, hidden: number, shown: number): void {
    const row = document.createElement('div');
    row.className = 'ep-layer-more';
    row.style.cssText = 'font-size:11px;color:#888;padding:2px 4px;cursor:pointer;';
    row.style.paddingLeft = '24px';
    row.textContent = `… 显示更多 ${hidden} 个`;
    row.addEventListener('click', () => {
      this.overrides.set(parent, shown * 2);
      this.listEl.dispatchEvent(new Event('ep-render'));
    });
    this.listEl.appendChild(row);
  }

  private appendRow(row: LayerRow, lock: { isLocked(e: Element): boolean }): void {
    const el = row.el;
    const rowEl = document.createElement('div');
    rowEl.className = 'ep-layer-row';
    rowEl.dataset.tag = el.tagName.toLowerCase();
    rowEl.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:12px;padding:2px 4px;cursor:pointer;';
    rowEl.style.paddingLeft = `${row.depth * 14 + 4}px`;
    if (el === this.selected) rowEl.style.background = '#dbeafe';

    // 折叠开关
    const toggle = document.createElement('span');
    toggle.className = 'ep-layer-toggle';
    toggle.style.cssText = 'width:12px;text-align:center;flex:none;cursor:pointer;user-select:none;';
    if (row.hasChildren) {
      toggle.textContent = this.expanded.has(el) ? '▾' : '▸';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.expanded.has(el)) this.expanded.delete(el);
        else this.expanded.add(el);
        this.listEl.dispatchEvent(new Event('ep-render'));
      });
    } else {
      toggle.textContent = '·';
    }
    rowEl.appendChild(toggle);

    const name = document.createElement('span');
    name.textContent = label(el);
    name.style.flex = '1';
    rowEl.style.overflow = 'hidden';
    rowEl.style.whiteSpace = 'nowrap';
    rowEl.addEventListener('click', () => this.hooks.select(el));
    rowEl.appendChild(name);

    // 排序按钮：上移/下移/置顶/置底
    const parent = el.parentElement;
    const kids = parent ? Array.from(parent.children) : [];
    const idx = kids.indexOf(el);
    const mkBtn = (txt: string, dir: -1 | 1 | 'top' | 'bottom', disabled: boolean) => {
      const b = document.createElement('button');
      b.className = 'ep-layer-reorder';
      b.dataset.dir = String(dir);
      b.textContent = txt;
      b.style.cssText = 'width:16px;height:16px;padding:0;font-size:9px;flex:none;';
      b.disabled = disabled;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.reorder(el, dir); });
      rowEl.appendChild(b);
    };
    const noParent = !parent;
    mkBtn('↑', 'top', noParent || idx === 0);
    mkBtn('↑', -1, noParent || idx <= 0);
    mkBtn('↓', 1, noParent || idx < 0 || idx >= kids.length - 1);
    mkBtn('↓', 'bottom', noParent || idx === kids.length - 1);

    const lockBtn = document.createElement('button');
    lockBtn.className = 'ep-layer-lock';
    lockBtn.textContent = lock.isLocked(el) ? '\u{1F512}' : '\u{1F513}';
    lockBtn.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.toggleLock(el); });
    rowEl.appendChild(lockBtn);

    const hideBtn = document.createElement('button');
    const hidden = (el as HTMLElement).style.display === 'none';
    hideBtn.textContent = hidden ? '🚫' : '👁';
    hideBtn.style.cssText = 'width:18px;height:18px;padding:0;font-size:10px;flex:none;';
    hideBtn.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.toggleHide(el); });
    rowEl.appendChild(hideBtn);

    this.listEl.appendChild(rowEl);
  }

  setSelected(el: Element | null): void {
    this.selected = el;
    // 只在选中新元素时自动展开祖先链；用户折叠后不再强制展开
    if (el && el !== this.lastAutoExpanded) {
      this.lastAutoExpanded = el;
      for (const a of ancestorChain(el)) this.expanded.add(a);
    }
  }

  /** 触发重新 render（折叠变化后由 App 调用 render）。 */
  bindRerender(cb: () => void): void {
    this.listEl.addEventListener('ep-render', cb);
  }
}
