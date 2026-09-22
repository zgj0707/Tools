// T114b 纯函数：选区合法性、包裹/解包、URL 规范化。不依赖 app/DOM 事件。

export type InlineTag = 'strong' | 'em' | 'u' | 'a';

export interface SelectionCheck {
  ok: boolean;
  reason?: 'collapsed' | 'crossNode' | 'crossElement' | 'empty' | 'notText';
}

export interface SelectionLike {
  readonly collapsed: boolean;
  readonly startContainer: Node;
  readonly endContainer: Node;
  readonly startOffset: number;
  readonly endOffset: number;
}

/** 合法选区判定：非折叠、起止同一文本节点、trim 非空。 */
export function checkSelection(range: SelectionLike): SelectionCheck {
  if (range.collapsed) return { ok: false, reason: 'collapsed' };
  const sc = range.startContainer;
  const ec = range.endContainer;
  if (sc !== ec) return { ok: false, reason: 'crossNode' };
  if (sc.nodeType !== 3) return { ok: false, reason: 'notText' };
  const text = sc.textContent?.slice(range.startOffset, range.endOffset) ?? '';
  if (text.trim() === '') return { ok: false, reason: 'empty' };
  return { ok: true };
}

/** 把文本节点按 offsets 切分，包裹选中段为 tag。返回新包裹元素。 */
export function wrapTextNode(textNode: Text, startOffset: number, endOffset: number, tag: InlineTag, href?: string): HTMLElement {
  const parent = textNode.parentNode!;
  const full = textNode.textContent ?? '';
  const before = full.slice(0, startOffset);
  const sel = full.slice(startOffset, endOffset);
  const after = full.slice(endOffset);
  const doc = textNode.ownerDocument;
  const wrap = doc.createElement(tag);
  wrap.textContent = sel;
  if (tag === 'a' && href) wrap.setAttribute('href', href);
  const frag = doc.createDocumentFragment();
  if (before) frag.appendChild(doc.createTextNode(before));
  frag.appendChild(wrap);
  if (after) frag.appendChild(doc.createTextNode(after));
  parent.replaceChild(frag, textNode);
  return wrap;
}

/** 解包：用 wrap 的文本子节点替换 wrap，并与相邻文本节点合并。 */
export function unwrapElement(wrap: HTMLElement): void {
  const parent = wrap.parentNode!;
  const frag = wrap.ownerDocument.createDocumentFragment();
  while (wrap.firstChild) frag.appendChild(wrap.firstChild);
  parent.replaceChild(frag, wrap);
  parent.normalize();
}

/** 若选区已被同 tag 完整包裹，返回该包裹元素；否则 null。 */
export function findEnclosingWrap(range: SelectionLike, tag: InlineTag): HTMLElement | null {
  const sc = range.startContainer;
  if (sc.nodeType !== 3) return null;
  const parent = sc.parentElement;
  if (!parent || parent.tagName.toLowerCase() !== tag) return null;
  // 选区起止都在该文本节点内，且该文本节点就是 parent 的唯一子节点
  if (parent.childNodes.length !== 1) return null;
  if (parent.firstChild !== sc) return null;
  return parent;
}

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'ftp:'];

/** URL 规范化与白名单。返回 null 表示拒绝。 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed;
  // 相对路径无协议
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    // 看起来像域名（含点、无空格）→ 补 https://
    if (trimmed.includes('.') && !trimmed.includes(' ')) return `https://${trimmed}`;
    return trimmed;
  }
  const proto = trimmed.split(':')[0]!.toLowerCase() + ':';
  if (SAFE_PROTOCOLS.includes(proto)) return trimmed;
  return null;
}
