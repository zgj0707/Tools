import { parse } from 'parse5';
import { EPX } from './anchors';

type Offset = { startOffset: number; endOffset: number };
type SourceLocation = Offset & {
  startTag?: Offset;
  endTag?: Offset;
  attrs?: Record<string, Offset>;
};
type SourceAttribute = { name: string; value: string; namespace?: string; prefix?: string };
type SourceNode = {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: SourceAttribute[];
  childNodes?: SourceNode[];
  content?: { childNodes: SourceNode[] };
  sourceCodeLocation?: SourceLocation | null;
  value?: string;
  data?: string;
  name?: string;
  publicId?: string;
  systemId?: string;
};
type Patch = { start: number; end: number; value: string };

export type SourcePatchResult =
  | { ok: true; html: string; patches: number }
  | { ok: false; reason: string };

export type HtmlEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
export interface DecodedHtml {
  text: string;
  encoding: HtmlEncoding;
  bom: boolean;
}

/** Capture the loaded document before the editor adds its host or makes edits. */
export function captureSourceBaseline(doc: Document): Document {
  return pageCopy(doc);
}

/** Remove only the toolbar host. It lives in shadow DOM and is never page content. */
function pageCopy(doc: Document): Document {
  const copy = doc.cloneNode(true) as Document;
  copy.querySelector(`[${EPX.HOST_MARKER_ATTR}="1"]`)?.remove();
  return copy;
}

function sourceChildren(node: SourceNode): SourceNode[] {
  if (node.nodeName === 'template' && node.content) return node.content.childNodes;
  return node.childNodes ?? [];
}

function domChildren(node: Node): Node[] {
  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'TEMPLATE') {
    return Array.from((node as HTMLTemplateElement).content.childNodes);
  }
  return Array.from(node.childNodes);
}

function sourceAttributes(node: SourceNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const attr of node.attrs ?? []) {
    out.set(attributeKey(attr.name, attr.namespace, attr.prefix), attr.value);
  }
  return out;
}

function domAttributes(node: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const attr of Array.from(node.attributes)) {
    out.set(attributeKey(attr.localName, attr.namespaceURI ?? undefined, attr.prefix ?? undefined), attr.value);
  }
  return out;
}

function attributeKey(name: string, namespace?: string, prefix?: string): string {
  return `${namespace ?? ''}|${prefix ?? ''}|${name.toLowerCase()}`;
}

function equivalent(source: SourceNode, dom: Node): boolean {
  if (source.nodeName === '#document') {
    if (dom.nodeType !== Node.DOCUMENT_NODE) return false;
    const sa = sourceChildren(source);
    const da = domChildren(dom);
    return sa.length === da.length && sa.every((child, i) => da[i] !== undefined && equivalent(child, da[i]));
  }
  if (source.nodeName === '#documentType') {
    const dt = dom as DocumentType;
    return dom.nodeType === Node.DOCUMENT_TYPE_NODE &&
      source.name?.toLowerCase() === dt.name.toLowerCase() &&
      (source.publicId ?? '') === dt.publicId &&
      (source.systemId ?? '') === dt.systemId;
  }
  if (source.nodeName === '#comment') {
    return dom.nodeType === Node.COMMENT_NODE && source.data === (dom as Comment).data;
  }
  if (source.nodeName === '#text') {
    return dom.nodeType === Node.TEXT_NODE && source.value === dom.nodeValue;
  }
  if (dom.nodeType !== Node.ELEMENT_NODE) return false;

  const el = dom as Element;
  if (source.tagName?.toLowerCase() !== el.localName.toLowerCase()) return false;
  if ((source.namespaceURI ?? '') !== (el.namespaceURI ?? '')) return false;
  const a = sourceAttributes(source);
  const b = domAttributes(el);
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;

  const sa = sourceChildren(source);
  const da = domChildren(el);
  if (sa.length !== da.length) return false;
  return sa.every((child, i) => da[i] !== undefined && equivalent(child, da[i]));
}

function isSameNodeKind(source: SourceNode, dom: Node): boolean {
  if (source.nodeName === '#document') return dom.nodeType === Node.DOCUMENT_NODE;
  if (source.nodeName === '#documentType') return dom.nodeType === Node.DOCUMENT_TYPE_NODE;
  if (source.nodeName === '#comment') return dom.nodeType === Node.COMMENT_NODE;
  if (source.nodeName === '#text') return dom.nodeType === Node.TEXT_NODE;
  return dom.nodeType === Node.ELEMENT_NODE &&
    source.tagName?.toLowerCase() === (dom as Element).localName.toLowerCase() &&
    (source.namespaceURI ?? '') === ((dom as Element).namespaceURI ?? '');
}

function rangeOf(value: Offset | undefined, source: string): Offset | null {
  if (!value || !Number.isInteger(value.startOffset) || !Number.isInteger(value.endOffset)) return null;
  if (value.startOffset < 0 || value.endOffset < value.startOffset || value.endOffset > source.length) return null;
  return value;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string, quote: string): string {
  let out = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (quote === '"') out = out.replace(/"/g, '&quot;');
  else out = out.replace(/'/g, '&#39;');
  return out;
}

function updatedAttribute(source: string, loc: Offset, value: string): string | null {
  const raw = source.slice(loc.startOffset, loc.endOffset);
  const nameMatch = /^\s*([^\s=/>]+)/.exec(raw);
  if (!nameMatch) return null;
  const originalName = nameMatch[1];
  const rest = raw.slice(nameMatch[0].length);
  const eq = /^\s*=\s*/.exec(rest);
  if (!eq) return `${originalName}="${escapeAttribute(value, '"')}"`;

  const prefix = `${nameMatch[0]}${eq[0]}`;
  const rawValue = rest.slice(eq[0].length);
  const quote = rawValue[0] === '"' || rawValue[0] === "'" ? rawValue[0] : '"';
  const suffix = rawValue[0] === '"' || rawValue[0] === "'"
    ? (rawValue.lastIndexOf(quote) > 0 ? rawValue.slice(rawValue.lastIndexOf(quote) + 1) : '')
    : '';
  return `${prefix}${quote}${escapeAttribute(value, quote)}${quote}${suffix}`;
}

function htmlForChildren(node: Element): string {
  return node.tagName === 'TEMPLATE'
    ? (node as HTMLTemplateElement).innerHTML
    : (node as HTMLElement).innerHTML;
}

function locationFor(node: SourceNode): SourceLocation | null {
  return node.sourceCodeLocation ?? null;
}

function rawTextParent(parent: Node | null): boolean {
  if (!parent || parent.nodeType !== Node.ELEMENT_NODE) return false;
  return /^(?:script|style|xmp|iframe|noembed|noframes|noscript|plaintext)$/i.test((parent as Element).localName);
}

/**
 * Reconcile an edited DOM against the exact source text. Unchanged source ranges are copied
 * verbatim; only changed text nodes, attributes, or the smallest changed element contents are
 * replaced. If the source cannot be mapped to the pre-edit DOM, callers must not overwrite.
 */
export function patchHtmlSource(source: string, baseline: Document, edited: Document): SourcePatchResult {
  const sourceTree = parse(source, { sourceCodeLocationInfo: true }) as unknown as SourceNode;
  const before = pageCopy(baseline);
  const after = pageCopy(edited);
  if (!equivalent(sourceTree, before)) {
    return { ok: false, reason: '原文件源码与编辑开始时的页面结构不一致，无法安全定位改动' };
  }

  const sourceFor = new WeakMap<Node, SourceNode>();
  const indexSource = (s: SourceNode, d: Node): void => {
    sourceFor.set(d, s);
    const sc = sourceChildren(s);
    const dc = domChildren(d);
    for (let i = 0; i < sc.length; i += 1) {
      const child = dc[i];
      const sourceChild = sc[i];
      if (child && sourceChild) indexSource(sourceChild, child);
    }
  };
  indexSource(sourceTree, before);

  const patches: Patch[] = [];
  let failure = '';
  const add = (start: number, end: number, value: string): void => {
    const range = rangeOf({ startOffset: start, endOffset: end }, source);
    if (!range) {
      failure = '源码位置超出原文件范围，已停止覆盖';
      return;
    }
    patches.push({ start, end, value });
  };

  const patchAttributes = (base: Element, now: Element, src: SourceNode): void => {
    const beforeAttrs = new Map(Array.from(base.attributes, (a) => [attributeKey(a.localName, a.namespaceURI ?? undefined, a.prefix ?? undefined), a]));
    const afterAttrs = new Map(Array.from(now.attributes, (a) => [attributeKey(a.localName, a.namespaceURI ?? undefined, a.prefix ?? undefined), a]));
    const loc = locationFor(src);
    const startTag = rangeOf(loc?.startTag, source);
    if (beforeAttrs.size === afterAttrs.size && [...beforeAttrs].every(([key, a]) => afterAttrs.get(key)?.value === a.value)) return;
    if (/^(?:script|style)$/i.test(base.localName)) {
      failure = `检测到 <${base.localName}> 属性运行时变化；已停止覆盖`;
      return;
    }
    if (!loc || !startTag) {
      failure = `无法定位 <${base.localName}> 的原始开始标签`;
      return;
    }

    const additions: string[] = [];
    for (const [key, oldAttr] of beforeAttrs) {
      const current = afterAttrs.get(key);
      if (current?.value === oldAttr.value) continue;
      const attrLoc = Object.entries(loc.attrs ?? {}).find(([name]) => name.toLowerCase() === oldAttr.name.toLowerCase())?.[1];
      const attrRange = rangeOf(attrLoc, source);
      if (!attrRange) {
        failure = `无法定位 <${base.localName}> 的属性 ${oldAttr.name}`;
        return;
      }
      if (!current) {
        add(attrRange.startOffset, attrRange.endOffset, '');
      } else {
        const value = updatedAttribute(source, attrRange, current.value);
        if (value === null) {
          failure = `无法保留 <${base.localName}> 的属性 ${oldAttr.name}`;
          return;
        }
        add(attrRange.startOffset, attrRange.endOffset, value);
      }
    }

    for (const [key, current] of afterAttrs) {
      if (beforeAttrs.has(key)) continue;
      if (!/^[^\s"'<>/=]+$/.test(current.name)) {
        failure = `新增属性 ${current.name} 的名称无法安全写回`;
        return;
      }
      additions.push(`${current.name}="${escapeAttribute(current.value, '"')}"`);
    }
    if (additions.length) {
      const startText = source.slice(startTag.startOffset, startTag.endOffset);
      const close = startText.lastIndexOf('>');
      if (close < 0) {
        failure = `无法定位 <${base.localName}> 的开始标签结尾`;
        return;
      }
      const insertAt = startTag.startOffset + (startText[close - 1] === '/' ? close - 1 : close);
      add(insertAt, insertAt, ` ${additions.join(' ')}`);
    }
  };

  const patchContents = (base: Element, now: Element, src: SourceNode): void => {
    if (/^(?:html|head|body|script|style|xmp|iframe|noembed|noframes|noscript|plaintext)$/i.test(base.localName)) {
      failure = `检测到 <${base.localName}> 运行内容变化；为避免写入脚本或样式副作用，已停止覆盖`;
      return;
    }
    const safeContentTags = new Set([
      'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote', 'button', 'caption', 'cite',
      'code', 'dd', 'div', 'dt', 'em', 'figcaption', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'header', 'i', 'label', 'li', 'main', 'mark', 'nav', 'p', 'pre', 'q', 's', 'section', 'small',
      'span', 'strong', 'summary', 'td', 'th', 'time', 'u',
    ]);
    if (!safeContentTags.has(base.localName.toLowerCase())) {
      failure = `无法确认 <${base.localName}> 是文字编辑区域，已停止结构性写回`;
      return;
    }
    const loc = locationFor(src);
    const startTag = rangeOf(loc?.startTag, source);
    const endTag = rangeOf(loc?.endTag, source);
    if (!startTag || !endTag || endTag.startOffset < startTag.endOffset) {
      failure = `无法精确定位 <${base.localName}> 的内容边界`;
      return;
    }
    const start = startTag.endOffset;
    const end = endTag.startOffset;
    // Large structural rewrites often indicate a framework replaced a whole section.
    // Re-serializing that much markup would undermine source preservation, so fail closed.
    if (end - start > Math.max(8192, source.length * 0.35)) {
      failure = `改动范围涉及 <${base.localName}> 的大段内容；为保护原排版，已停止覆盖`;
      return;
    }
    add(start, end, htmlForChildren(now));
  };

  const patchInlineWrapper = (oldChildren: Node[], newChildren: Node[]): boolean => {
    const inlineTags = new Set(['strong', 'em', 'u']);

    // The editor's format command splits one text node and inserts a plain inline tag.
    // When its source contains no entities or normalized line endings, retain the exact
    // source text and insert only the two wrapper tags.
    let wrapMatch: { openAt: number; closeAt: number; open: string; close: string } | null = null;
    for (let i = 0; i < oldChildren.length; i += 1) {
      const oldText = oldChildren[i];
      if (!oldText || oldText.nodeType !== Node.TEXT_NODE) continue;
      const src = sourceFor.get(oldText);
      const textRange = rangeOf(src?.sourceCodeLocation ?? undefined, source);
      if (!textRange || source.slice(textRange.startOffset, textRange.endOffset) !== (oldText.nodeValue ?? '')) continue;

      for (const hasBefore of [false, true]) {
        for (const hasAfter of [false, true]) {
          const segmentLength = 1 + Number(hasBefore) + Number(hasAfter);
          const start = i;
          const end = start + segmentLength;
          if (newChildren.length !== oldChildren.length - 1 + segmentLength) continue;
          const unchangedPrefix = oldChildren.slice(0, i).every((child, index) => {
            const childSource = sourceFor.get(child);
            return !!childSource && !!newChildren[index] && equivalent(childSource, newChildren[index]!);
          });
          const unchangedSuffix = oldChildren.slice(i + 1).every((child, offset) => {
            const childSource = sourceFor.get(child);
            return !!childSource && !!newChildren[end + offset] && equivalent(childSource, newChildren[end + offset]!);
          });
          if (!unchangedPrefix || !unchangedSuffix) continue;

          let at = start;
          const before = hasBefore ? newChildren[at++] : null;
          const wrapped = newChildren[at++];
          const after = hasAfter ? newChildren[at] : null;
          if (hasBefore && (!before || before.nodeType !== Node.TEXT_NODE || !before.nodeValue)) continue;
          if (hasAfter && (!after || after.nodeType !== Node.TEXT_NODE || !after.nodeValue)) continue;
          if (!wrapped || wrapped.nodeType !== Node.ELEMENT_NODE) continue;
          const el = wrapped as Element;
          if (!inlineTags.has(el.localName.toLowerCase()) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml' || el.attributes.length !== 0) continue;
          if (el.childNodes.length !== 1 || el.firstChild?.nodeType !== Node.TEXT_NODE) continue;
          const beforeText = before?.nodeValue ?? '';
          const selectedText = el.textContent ?? '';
          const afterText = after?.nodeValue ?? '';
          if (!selectedText || `${beforeText}${selectedText}${afterText}` !== (oldText.nodeValue ?? '')) continue;

          const openAt = textRange.startOffset + beforeText.length;
          const closeAt = openAt + selectedText.length;
          if (wrapMatch) return false;
          wrapMatch = {
            openAt,
            closeAt,
            open: `<${el.localName.toLowerCase()}>`,
            close: `</${el.localName.toLowerCase()}>`,
          };
        }
      }
    }
    if (wrapMatch) {
      add(wrapMatch.openAt, wrapMatch.openAt, wrapMatch.open);
      add(wrapMatch.closeAt, wrapMatch.closeAt, wrapMatch.close);
      return true;
    }

    // Toggling an existing simple wrapper off removes only its opening and closing tags;
    // any whitespace, entities, or line breaks inside remain byte-for-byte untouched.
    let unwrapMatch: { open: Offset; close: Offset } | null = null;
    for (let i = 0; i < oldChildren.length; i += 1) {
      const oldWrap = oldChildren[i];
      const newText = newChildren[i];
      if (!oldWrap || oldWrap.nodeType !== Node.ELEMENT_NODE || !newText || newText.nodeType !== Node.TEXT_NODE) continue;
      const el = oldWrap as Element;
      if (!inlineTags.has(el.localName.toLowerCase()) || el.childNodes.length !== 1 || el.firstChild?.nodeType !== Node.TEXT_NODE) continue;
      if (newChildren.length !== oldChildren.length) continue;
      if ((newText.nodeValue ?? '') !== (el.textContent ?? '')) continue;
      const unchangedPrefix = oldChildren.slice(0, i).every((child, index) => {
        const childSource = sourceFor.get(child);
        return !!childSource && !!newChildren[index] && equivalent(childSource, newChildren[index]!);
      });
      const unchangedSuffix = oldChildren.slice(i + 1).every((child, offset) => {
        const childSource = sourceFor.get(child);
        return !!childSource && !!newChildren[i + 1 + offset] && equivalent(childSource, newChildren[i + 1 + offset]!);
      });
      if (!unchangedPrefix || !unchangedSuffix) continue;
      const loc = locationFor(sourceFor.get(oldWrap) ?? { nodeName: '' });
      const open = rangeOf(loc?.startTag, source);
      const close = rangeOf(loc?.endTag, source);
      if (!open || !close) continue;
      if (unwrapMatch) return false;
      unwrapMatch = { open, close };
    }
    if (!unwrapMatch) return false;
    add(unwrapMatch.open.startOffset, unwrapMatch.open.endOffset, '');
    add(unwrapMatch.close.startOffset, unwrapMatch.close.endOffset, '');
    return true;
  };

  const diff = (base: Node, now: Node): void => {
    if (failure) return;
    const src = sourceFor.get(base);
    if (!src || !isSameNodeKind(src, now)) {
      failure = '页面节点已变化，无法安全映射到原始源码';
      return;
    }
    if (base.nodeType === Node.TEXT_NODE) {
      if (base.nodeValue !== now.nodeValue) {
        if (rawTextParent(base.parentNode)) {
          failure = '检测到脚本或原始文本区域变化，已停止覆盖';
          return;
        }
        const loc = rangeOf(src.sourceCodeLocation ?? undefined, source);
        if (!loc) {
          failure = '无法定位改动文字的原始源码位置';
          return;
        }
        add(loc.startOffset, loc.endOffset, escapeText(now.nodeValue ?? ''));
      }
      return;
    }
    if (base.nodeType === Node.COMMENT_NODE) {
      if ((base as Comment).data !== (now as Comment).data) {
        failure = '检测到 HTML 注释变化，已停止覆盖以保护原源码';
      }
      return;
    }
    if (base.nodeType !== Node.ELEMENT_NODE && base.nodeType !== Node.DOCUMENT_NODE) return;

    if (base.nodeType === Node.ELEMENT_NODE) patchAttributes(base as Element, now as Element, src);
    const oldChildren = domChildren(base);
    const newChildren = domChildren(now);
    const shapeMatches = oldChildren.length === newChildren.length && oldChildren.every((child, i) => {
      const next = newChildren[i];
      return next !== undefined && isSameNodeKind(sourceFor.get(child) ?? { nodeName: '' }, next);
    });
    if (!shapeMatches) {
      if (base.nodeType !== Node.ELEMENT_NODE) {
        failure = '页面根节点结构变化，无法进行局部源码写回';
        return;
      }
      if (patchInlineWrapper(oldChildren, newChildren)) return;
      patchContents(base as Element, now as Element, src);
      return;
    }
    for (let i = 0; i < oldChildren.length; i += 1) {
      const oldChild = oldChildren[i];
      const newChild = newChildren[i];
      if (oldChild && newChild) diff(oldChild, newChild);
    }
  };

  diff(before, after);
  if (failure) return { ok: false, reason: failure };

  patches.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < patches.length; i += 1) {
    const previous = patches[i - 1];
    const current = patches[i];
    if (previous && current && previous.end > current.start) {
      return { ok: false, reason: '改动区域互相重叠，无法安全局部写回' };
    }
  }
  let html = source;
  for (const patch of [...patches].reverse()) {
    html = `${html.slice(0, patch.start)}${patch.value}${html.slice(patch.end)}`;
  }
  return { ok: true, html, patches: patches.length };
}

/** Decode only encodings that can be written back without changing the source encoding. */
export function decodeHtmlSource(
  bytes: Uint8Array,
  documentEncoding?: string,
): { ok: true; value: DecodedHtml } | { ok: false; reason: string } {
  const startsWith = (...values: number[]): boolean => values.every((value, i) => bytes[i] === value);
  let encoding: HtmlEncoding = 'utf-8';
  let bom = false;
  let skip = 0;
  if (startsWith(0xef, 0xbb, 0xbf)) {
    bom = true;
    skip = 3;
  } else if (startsWith(0xff, 0xfe)) {
    encoding = 'utf-16le';
    bom = true;
    skip = 2;
  } else if (startsWith(0xfe, 0xff)) {
    encoding = 'utf-16be';
    bom = true;
    skip = 2;
  } else {
    const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const declared = prefix.match(/<meta\b[^>]*(?:charset\s*=\s*["']?\s*([\w.-]+)|content\s*=\s*["'][^"']*charset=([\w.-]+))/i);
    const charset = (declared?.[1] ?? declared?.[2] ?? documentEncoding ?? '').toLowerCase();
    if (['windows-1252', 'cp1252', 'iso-8859-1', 'latin1', 'us-ascii', 'ascii'].includes(charset)) {
      encoding = 'windows-1252';
    } else if (['utf-16le', 'utf16le'].includes(charset)) {
      encoding = 'utf-16le';
    } else if (['utf-16be', 'utf16be'].includes(charset)) {
      encoding = 'utf-16be';
    } else if (charset && !['utf-8', 'utf8'].includes(charset)) {
      return { ok: false, reason: `原件编码为 ${charset}；为避免改写后乱码，当前仅能安全保留 UTF-8、UTF-16 与 Windows-1252` };
    }
  }
  if ((encoding === 'utf-16le' || encoding === 'utf-16be') && (bytes.length - skip) % 2 !== 0) {
    return { ok: false, reason: '原件 UTF-16 字节长度异常，已停止覆盖' };
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(skip));
    if (encoding === 'windows-1252') {
      const roundTrip = encodeHtmlSource(text, encoding, false);
      const original = bytes.subarray(skip);
      if (roundTrip.length !== original.length || roundTrip.some((byte, i) => byte !== original[i])) {
        return { ok: false, reason: '原件 Windows-1252 字节不能无损往返，已停止覆盖' };
      }
    }
    return { ok: true, value: { text, encoding, bom } };
  } catch {
    return { ok: false, reason: `原件 ${encoding} 编码包含无法解码的数据，已停止覆盖` };
  }
}

export function encodeHtmlSource(text: string, encoding: HtmlEncoding, bom: boolean): Uint8Array {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new RangeError('编辑内容包含无效 Unicode 字符');
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new RangeError('编辑内容包含无效 Unicode 字符');
    }
  }
  let body: Uint8Array;
  if (encoding === 'utf-8') {
    body = new TextEncoder().encode(text);
  } else if (encoding === 'windows-1252') {
    const special = new Map<number, number>([
      [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
      [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
      [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
      [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
      [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
      [0x017e, 0x9e], [0x0178, 0x9f],
    ]);
    const bytes: number[] = [];
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      const byte = code <= 0x7f || (code >= 0xa0 && code <= 0xff) ? code : special.get(code);
      if (byte === undefined) throw new RangeError('当前修改包含 Windows-1252 无法表示的字符');
      bytes.push(byte);
    }
    body = new Uint8Array(bytes);
  } else {
    body = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (encoding === 'utf-16le') {
        body[i * 2] = code & 0xff;
        body[i * 2 + 1] = code >>> 8;
      } else {
        body[i * 2] = code >>> 8;
        body[i * 2 + 1] = code & 0xff;
      }
    }
  }
  if (!bom) return body;
  const prefix = encoding === 'utf-8'
    ? [0xef, 0xbb, 0xbf]
    : encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff];
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}
