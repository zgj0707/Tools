// 插入元素工厂（T111）：用被编辑文档 doc.createElement 生成节点 + 默认样式常量。纯函数决策。

export type ElementKind =
  | 'h1' | 'h2' | 'h3' | 'p' | 'button'
  | 'img' | 'div' | 'hr' | 'section' | 'table';

export const KIND_LABELS: Record<ElementKind, string> = {
  h1: '标题 1', h2: '标题 2', h3: '标题 3', p: '段落', button: '按钮',
  img: '图片', div: '容器', hr: '分割线', section: '区块', table: '表格',
};

/** 占位图（内置 SVG data URI，纯本地）。 */
export const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">img</text></svg>');

const DEFAULT_TEXT: Record<string, string> = {
  h1: '新标题', h2: '新标题', h3: '新标题', p: '新段落', button: '按钮',
};

/** 用被编辑文档创建 img；占位才带虚线提示框，真实 src 不画框。 */
export function createImage(doc: Document, src: string, isPlaceholder = false): HTMLImageElement {
  const el = doc.createElement('img');
  el.src = src;
  el.alt = 'image';
  if (isPlaceholder) el.style.border = '1px dashed #ccc';
  return el;
}

/** 用被编辑文档 doc.createElement（跨 realm，绝不外壳 document）。 */
export function create(doc: Document, kind: ElementKind): Node {
  switch (kind) {
    case 'img':
      return createImage(doc, PLACEHOLDER_IMG, true);
    case 'hr':
      return doc.createElement('hr');
    case 'table': {
      const table = doc.createElement('table');
      table.style.borderCollapse = 'collapse';
      table.style.border = '1px solid #999';
      for (let r = 0; r < 2; r++) {
        const tr = doc.createElement('tr');
        for (let c = 0; c < 2; c++) {
          const td = doc.createElement('td');
          td.style.border = '1px solid #999';
          td.style.padding = '6px';
          td.textContent = '　';
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      return table;
    }
    case 'div':
    case 'section': {
      const el = doc.createElement(kind);
      el.style.minHeight = '40px';
      return el;
    }
    case 'button': {
      const el = doc.createElement('button');
      el.textContent = DEFAULT_TEXT.button ?? '按钮';
      el.type = 'button';
      return el;
    }
    default: {
      const el = doc.createElement(kind);
      el.textContent = DEFAULT_TEXT[kind] ?? '新内容';
      return el;
    }
  }
}

/** 插入位置决策：返回 parent 与 index。 */
export function insertionPoint(doc: Document, selected: Element | null): { parent: Element; index: number } {
  if (selected) {
    // 通用容器（table 不按容器，避免把非 tr 节点塞进 <table>）
    const container = ['DIV', 'SECTION', 'BODY'].includes(selected.tagName);
    if (container) {
      return { parent: selected, index: selected.children.length };
    }
    const parent = selected.parentElement ?? doc.body;
    const idx = Array.from(parent.children).indexOf(selected as Element);
    return { parent, index: idx + 1 };
  }
  return { parent: doc.body, index: doc.body.children.length };
}
