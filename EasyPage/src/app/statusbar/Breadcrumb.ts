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
    this.el.style.fontSize = '12px';
    this.el.style.minHeight = '1.5em';
    this.el.style.color = '#666';
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
      span.style.cursor = 'pointer';
      span.style.padding = '0 4px';
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
