// 复制节点纯逻辑（T114）：在编辑 doc 内深拷贝节点，剥除编辑器标记，生成唯一 id，插到原节点之后。
// core/elements 不 import app/adapters，doc 由参数传入。

const EDITOR_CLASS_PREFIX = 'ep-';
const EDITOR_ID_PREFIX = 'ep-';

/** 剥除编辑器/外壳标记（递归）。 */
export function stripEditorMarkups(node: Node): void {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'contenteditable' || attr.name.startsWith('data-ep-')) el.removeAttribute(attr.name);
  }
  if (el.id.startsWith(EDITOR_ID_PREFIX)) el.removeAttribute('id');
  // 剥除 ep- 前缀 class
  const classes = Array.from(el.classList);
  for (const c of classes) {
    if (c.startsWith(EDITOR_CLASS_PREFIX)) el.classList.remove(c);
  }
  for (const child of Array.from(el.childNodes)) stripEditorMarkups(child);
}

/** 生成不与文档现有 id 冲突的新 id。 */
export function uniqueId(doc: Document, base: string): string {
  let candidate = `${base}-copy`;
  let i = 2;
  while (doc.getElementById(candidate)) {
    candidate = `${base}-copy-${i}`;
    i += 1;
  }
  return candidate;
}

/** 深拷贝节点：在原节点之后插入副本，返回新节点。 */
export function duplicateNode(doc: Document, source: Element): Element {
  const parent = source.parentElement;
  if (!parent) throw new Error('EP.DUPLICATE.NO_PARENT');
  const clone = source.cloneNode(true) as Element;
  stripEditorMarkups(clone);
  if (source.id) {
    clone.id = uniqueId(doc, source.id);
  }
  const idx = Array.from(parent.children).indexOf(source);
  parent.insertBefore(clone, parent.children[idx + 1] ?? null);
  return clone;
}
