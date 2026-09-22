// 导出前清理（契约 01 §8.3）。纯函数，作用于被编辑 Document，与 qa/metrics/run-metrics.mjs 六类口径同源：
//   ① 残留 contenteditable 与 data-ep-editing
//   ② 任何 data-ep-* 属性
//   ③ 覆盖层 #ep-overlay-root 节点（不在被编辑 doc 内，本卡防御性清理）
//   ④ 编辑器注入的 <style id="ep-*"> / <script id="ep-*">
//   ⑤ 仅编辑期使用的临时 class（ep- 前缀）
// core 层不 import app/adapters/第三方包。

import type { EditorArtifact } from '../ports';
import { EP } from '../../constants';

const EP_ATTR_PREFIX = 'data-ep-';
const EP_CLASS_PREFIX = EP.CLASS_PREFIX; // 'ep-'
const EP_INJECTED_ID_PREFIX = 'ep-';

/** 就地清理被编辑 Document 中的编辑器残留（mutate）。 */
export function stripEditorArtifacts(doc: Document): void {
  // ③ 覆盖层节点（防御性：本卡覆盖层在外壳，正常不应出现在被编辑 doc）
  const overlay = doc.getElementById(EP.OVERLAY_ROOT);
  if (overlay) overlay.remove();

  // ④ 编辑器注入的 style/script
  doc
    .querySelectorAll<HTMLStyleElement | HTMLScriptElement>('style[id^="ep-"], script[id^="ep-"]')
    .forEach((node) => node.remove());

  // ①②⑤ 遍历所有元素清理属性与 class
  doc.querySelectorAll('*').forEach((el) => {
    // ① contenteditable
    if (el.hasAttribute('contenteditable')) {
      el.removeAttribute('contenteditable');
    }
    // ② data-ep-* 属性（含 data-ep-editing）
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (attr.name === EP.EDITING_ATTR || attr.name.startsWith(EP_ATTR_PREFIX)) {
        el.removeAttribute(attr.name);
      }
    }
    // ⑤ 仅编辑期临时 class（ep- 前缀）；用户自有 class 保留
    const keptClasses = Array.from(el.classList).filter((c) => !c.startsWith(EP_CLASS_PREFIX));
    if (keptClasses.length === 0) {
      if (el.hasAttribute('class')) el.removeAttribute('class');
    } else {
      el.setAttribute('class', keptClasses.join(' '));
    }
  });
}

/** 清理后残留检测（应返回空数组；非空则导出阻断）。口径与 metrics 六类正则一致。 */
export function collectResidue(doc: Document): EditorArtifact[] {
  const residue: EditorArtifact[] = [];

  doc.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'contenteditable') {
        residue.push({ kind: 'contenteditable', detail: `<${tag}>@contenteditable` });
      }
      if (attr.name.startsWith(EP_ATTR_PREFIX)) {
        residue.push({ kind: 'data-ep-*', detail: `<${tag}>@${attr.name}` });
      }
    }
    const cls = el.getAttribute('class');
    if (cls && cls.split(/\s+/).some((c) => c.startsWith(EP_CLASS_PREFIX))) {
      residue.push({ kind: 'class="ep-*"', detail: `<${tag}>@class="${cls}"` });
    }
  });

  if (doc.getElementById(EP.OVERLAY_ROOT)) {
    residue.push({ kind: 'ep-overlay-root', detail: `#${EP.OVERLAY_ROOT}` });
  }

  doc
    .querySelectorAll<HTMLStyleElement | HTMLScriptElement>(
      `style[id^="${EP_INJECTED_ID_PREFIX}"], script[id^="${EP_INJECTED_ID_PREFIX}"]`,
    )
    .forEach((node) => {
      residue.push({
        kind: `<${node.tagName.toLowerCase()} id="ep-*">`,
        detail: node.id,
      });
    });

  return residue;
}
