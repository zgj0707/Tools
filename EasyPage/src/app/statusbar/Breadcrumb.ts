// 面包屑状态栏：自选中元素向上取 tag#id.class 链（最多 8 级），点击逐级选中父级。

const MAX_DEPTH = 8;

function labelOf(el: Element): string {
  let label = el.tagName.toLowerCase();
  if (el.id) label += `#${el.id}`;
  for (const cls of Array.from(el.classList)) {
    label += `.${cls}`;
  }
  return label;
}

export class Breadcrumb {
  private readonly el: HTMLElement;
  private pickHandler: ((el: Element) => void) | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    // 视觉（字号 / 最小高度 / 颜色 / 内边距）由 app.css 的 .ep-statusbar 承担。
    // 该容器由 App.ts 的挂载骨架创建时即带 ep-statusbar 类名，本组件不再重复挂类
    // —— 只负责往容器里渲染逐级面包屑（id="ep-breadcrumb" 与 DOM 结构保持不变）。
  }

  onPick(handler: (el: Element) => void): void {
    this.pickHandler = handler;
  }

  render(target: Element | null): void {
    this.el.textContent = '';
    if (!target) return;

    const chain: Element[] = [];
    let cur: Element | null = target;
    while (cur && cur.nodeType === 1 && chain.length < MAX_DEPTH) {
      chain.push(cur);
      cur = cur.parentElement;
    }
    chain.reverse(); // 外层在前，当前元素在末尾

    chain.forEach((node, i) => {
      const span = document.createElement('span');
      span.textContent = labelOf(node);
      // 逐级可点的 cursor 与点击行为绑定，且画布外无对应 CSS 规则，保留内联；
      // 左右留白改用 token，去掉魔法数字。
      span.style.cursor = 'pointer';
      span.style.padding = '0 var(--ep-sp-1)';
      span.addEventListener('click', () => this.pickHandler?.(node));
      this.el.appendChild(span);
      if (i < chain.length - 1) {
        const sep = document.createElement('span');
        sep.textContent = '›';
        this.el.appendChild(sep);
      }
    });
  }
}
