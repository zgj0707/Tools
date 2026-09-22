// 列表互转纯函数（T111b）：P/H1-H3 ↔ ul/ol 单层互转。子节点移动不复制。

const WRAP_TAGS = ['P', 'H1', 'H2', 'H3'];
const BLOCK_TAGS = ['DIV', 'TABLE', 'UL', 'OL', 'SECTION', 'HEADER', 'FOOTER', 'NAV'];

/** 块内是否含 block-level 子元素。 */
function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK_TAGS.includes(c.tagName));
}

/** 可包裹：单选 P/H1-H3 且不含块级子元素。 */
export function canWrapList(el: Element): boolean {
  if (!WRAP_TAGS.includes(el.tagName)) return false;
  if (hasBlockChild(el)) return false;
  const inTable = !!el.closest('table');
  return !inTable;
}

/** 单层 ul/ol：li 不嵌套 ul/ol、不含块级子元素。 */
export function canUnwrapList(el: Element): boolean {
  if (!['UL', 'OL'].includes(el.tagName)) return false;
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') return false;
    if (Array.from(li.children).some((c) => c.tagName !== 'IMG' && BLOCK_TAGS.includes(c.tagName) || ['UL', 'OL'].includes(c.tagName))) {
      return false;
    }
  }
  return true;
}

/** 把 block 的全部 childNodes 移动进 li，返回 list。 */
export function buildList(doc: Document, block: Element, tag: 'ul' | 'ol'): Element {
  const list = doc.createElement(tag);
  const li = doc.createElement('li');
  while (block.firstChild) li.appendChild(block.firstChild);
  list.appendChild(li);
  return list;
}

/** 单层 list 的每个 li → 一个 p，返回 p[]。 */
export function unwrapList(doc: Document, list: Element): Element[] {
  const out: Element[] = [];
  for (const li of Array.from(list.children)) {
    const p = doc.createElement('p');
    while (li.firstChild) p.appendChild(li.firstChild);
    out.push(p);
  }
  return out;
}
