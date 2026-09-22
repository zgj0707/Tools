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
    // 宽度 / 内边距 / 分隔线 / max-height / overflow 由 style/app.css 的 .ep-layers 承担
    this.root.className = 'ep-layers';
    const title = document.createElement('h3');
    title.textContent = '图层';
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
    // 缩进是树形结构的几何结果，保留内联
    rowEl.style.paddingLeft = `${row.depth * 14 + 4}px`;
    // 选中行高亮：原为内联 #dbeafe，现统一到 token
    // （.ep-layer-row--selected → var(--ep-focus-bg) = #EDF3FF，测试已同步）
    rowEl.classList.toggle('ep-layer-row--selected', el === this.selected);

    // 折叠开关
    const toggle = document.createElement('span');
    toggle.className = 'ep-layer-toggle';
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
    rowEl.addEventListener('click', () => this.hooks.select(el));
    rowEl.appendChild(name);

    // 排序按钮：置顶/上移/下移/置底
    const parent = el.parentElement;
    const kids = parent ? Array.from(parent.children) : [];
    const idx = kids.indexOf(el);
    // 原先四个按钮写成 `↑ ↑ ↓ ↓` —— 两组文案完全相同，用户无法分辨
    // 「置顶 vs 上移」「下移 vs 置底」（T122 走查发现）。改用成对符号区分，
    // 并补 title 供 hover 时确认语义。
    // ⚠️ data-dir 是 e2e 的定位锚点（layers.spec 用 button[data-dir="-1"]），不得改动；
    //    title 只作 tooltip，不会成为可访问名（按钮有 textContent）。
    const mkBtn = (txt: string, dir: -1 | 1 | 'top' | 'bottom', disabled: boolean, title: string) => {
      const b = document.createElement('button');
      b.className = 'ep-layer-reorder';
      b.dataset.dir = String(dir);
      b.textContent = txt;
      b.title = title;
      b.disabled = disabled;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.reorder(el, dir); });
      rowEl.appendChild(b);
    };
    const noParent = !parent;
    mkBtn('\u2912', 'top', noParent || idx === 0, '置顶');
    mkBtn('\u2191', -1, noParent || idx <= 0, '上移');
    mkBtn('\u2193', 1, noParent || idx < 0 || idx >= kids.length - 1, '下移');
    mkBtn('\u2913', 'bottom', noParent || idx === kids.length - 1, '置底');

    const lockBtn = document.createElement('button');
    lockBtn.className = 'ep-layer-lock';
    lockBtn.textContent = lock.isLocked(el) ? '\u{1F512}' : '\u{1F513}';
    lockBtn.title = lock.isLocked(el) ? '解锁：允许移动与编辑' : '锁定：禁止移动与编辑';
    lockBtn.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.toggleLock(el); });
    rowEl.appendChild(lockBtn);

    const hideBtn = document.createElement('button');
    const hidden = (el as HTMLElement).style.display === 'none';
    // 原先无类名、纯内联；补 .ep-layer-hide 供 CSS 接管
    // （e2e 按 👁 / 🚫 文本定位这个按钮，加类名不影响）
    hideBtn.className = 'ep-layer-hide';
    hideBtn.textContent = hidden ? '🚫' : '👁';
    hideBtn.title = hidden ? '显示该元素' : '隐藏该元素';
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
