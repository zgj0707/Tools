// 属性面板可折叠分组（批次 1 · R7）。
//
// 【为什么必须做】
// E4 实测：右侧面板 30 个字段排成一列自高 1221px，1440 视口下要滚动 45%、1280 下 65%。
// 用户想改「字号」得先跨过盒模型 12 项；想改「圆角」得先滚到底。
//
// 【为什么用 display:none 而不是 max-height 动画】
// 收起态必须是**确定性的不可见**：不进布局、不进可访问性树、不参与 e2e 的
// `locator().nth(i)` 可见性判定。max-height:0 的元素仍可命中，会制造
// 「点了看不见的输入框」这类假通过。与 .ep-panel / .ep-elements 的收放同因同法。
//
// 【DOM 顺序红线】
// 分组只负责「包裹」，不重排字段。e2e 大量使用 `panel.locator('input[type=number]').nth(0)`
// 这类**按文档序取第 n 个**的定位（style-text / style-box / style-guard 等 spec），
// 一旦分组把字段挪位，这批断言会集体错位。

export interface SectionOptions {
  /** 分组 id，作为 data-section 与持久化键。 */
  id: string;
  /** 分组标题（可访问名，即 e2e 定位锚点）。 */
  title: string;
  /** 初始展开态。 */
  open: boolean;
  /** 用户点击折叠头时回调。 */
  onToggle: (id: string, open: boolean) => void;
}

export class Section {
  readonly root: HTMLElement;
  /** 宿主容器：把字段 append 到这里，而不是 root（避免与折叠头同层）。 */
  readonly body: HTMLElement;
  private readonly head: HTMLButtonElement;
  private readonly opts: SectionOptions;

  constructor(opts: SectionOptions) {
    this.opts = opts;

    this.root = document.createElement('section');
    this.root.className = 'ep-section';
    this.root.dataset.section = opts.id;

    this.head = document.createElement('button');
    this.head.type = 'button';
    this.head.className = 'ep-section__head';
    const arrow = document.createElement('span');
    arrow.className = 'ep-section__arrow';
    arrow.textContent = '▾';
    const label = document.createElement('span');
    label.textContent = opts.title;
    this.head.append(arrow, label);
    this.head.addEventListener('click', () => this.setOpen(!this.isOpen()));

    this.body = document.createElement('div');
    this.body.className = 'ep-section__body';

    this.root.append(this.head, this.body);
    this.setOpen(opts.open, { silent: true });
  }

  isOpen(): boolean {
    return this.root.dataset.open === 'true';
  }

  setOpen(open: boolean, opts: { silent?: boolean } = {}): void {
    this.root.dataset.open = open ? 'true' : 'false';
    this.head.setAttribute('aria-expanded', String(open));
    if (!opts.silent) this.opts.onToggle(this.opts.id, open);
  }
}
