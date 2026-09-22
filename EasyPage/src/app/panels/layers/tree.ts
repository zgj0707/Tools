// 图层面板纯函数（T112）：收集可见行 + 折叠/懒渲染。不依赖外壳 DOM，可单测。

const SKIP = new Set(['HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'BR', 'HR']);

export interface LayerRow {
  el: Element;
  depth: number;
  hasChildren: boolean;
}

export interface CollectOptions {
  expanded: Set<Element>;
  perNodeLimit?: number;
  limitFor?: (parent: Element) => number;
  onTruncated?: (parent: Element, hidden: number) => void;
}

function shouldSkip(el: Element): boolean {
  if (SKIP.has(el.tagName)) return true;
  const cls = (el.getAttribute('class') ?? '') + ' ' + (el.className?.toString?.() ?? '');
  return cls.trim().split(/\s+/).some((c) => c.startsWith('ep-'));
}

/**
 * 从 body 收集要渲染的行。折叠的容器不展开子树；每个容器子节点超过 perNodeLimit 时截断，
 * 触发 onTruncated 回调让 UI 渲染"显示更多 N 个"。
 */
export function collectRows(doc: Document, opts: CollectOptions): LayerRow[] {
  const body = doc.body;
  if (!body) return [];
  const rows: LayerRow[] = [];

  const walk = (el: Element, depth: number) => {
    const kids = Array.from(el.children).filter((c) => !shouldSkip(c));
    rows.push({ el, depth, hasChildren: kids.length > 0 });
    if (!opts.expanded.has(el)) return;
    const limit = opts.limitFor?.(el) ?? opts.perNodeLimit ?? 200;
    const shown = kids.slice(0, limit);
    for (const c of shown) walk(c, depth + 1);
    if (kids.length > shown.length) {
      opts.onTruncated?.(el, kids.length - shown.length);
    }
  };

  const top = Array.from(body.children).filter((c) => !shouldSkip(c));
  const topLimit = opts.limitFor?.(body) ?? opts.perNodeLimit ?? 200;
  const shownTop = top.slice(0, topLimit);
  for (const c of shownTop) walk(c, 0);
  if (top.length > shownTop.length) opts.onTruncated?.(body, top.length - shownTop.length);
  return rows;
}

/** 收集 el 到 body 的祖先链（不含 el 自身），用于选中时自动展开。 */
export function ancestorChain(el: Element): Element[] {
  const chain: Element[] = [];
  let p = el.parentElement;
  while (p) {
    chain.unshift(p);
    p = p.parentElement;
  }
  return chain;
}
