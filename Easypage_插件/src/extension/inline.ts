// 就地改字（P0-4）：双击元素 → 直接在上面改文字。
//
// 与旧的 `app/canvas/InlineTextEditor.ts` 只有一处关键差别，但很要紧：
// **提交时写回 `innerHTML` 而不是 `textContent`。**
//
// 旧实现用 `el.textContent = next` 提交，那会用「拼平后的纯文本」覆盖元素内容 ——
// 于是 `<p>结论：<strong>留存下滑</strong>，需要关注</p>` 改完只剩下纯文本，
// `<strong>` 连同它的加粗一起没了。用户只是想改几个字，却丢了行内格式。
// 这在旧形态里就存在（当时改的是导入进来的副本），插件形态下后果更重 ——
// **改的是用户自己的那份文件**。
//
// 走 innerHTML 不会引入外部标签：粘贴被强制走纯文本通道（见下方 paste 处理），
// 用户敲进去的字本来就是文本节点。加粗/倾斜/下划线由工具条的内联样式承担，
// 不会被这一层搅动。
//
// 就地编辑标记沿用 `EP.EDITING_ATTR`（`data-ep-editing`）——
// 与 `core/serialize/stripArtifacts.ts` 认的是同一个属性名，P0-5 写回时能直接复用净化器。
//
// ⚠️ 「哪些元素能改字」的判定在 2026-09-23 改过一次，见 `isTextEditable`：
// 从「标签白名单」改成「结构性判定」，因为白名单覆盖不到裸 `<div>`/`<section>` 里的文字
// （用户实测反馈「编辑不了容器内的东西」）。

import { EP } from '../constants';
import { hasOwnBox } from './pick';

/**
 * 绝不该被就地改字的元素。
 *
 * 两类：
 *   · **替换元素与表单控件**（img / input / textarea / video…）—— 它们不是文字容器，
 *     双击它们的意图是选中图形或聚焦控件，不是「改这里的字」。
 *     ⚠️ 必须在结构判定**之前**拦：`<img>` 没有子元素、`<textarea>` 的 textContent 是它的
 *     默认值，单看结构两者都会被误判成「可改」。
 *   · **文档结构元素**（html / body / head / script / style…）—— 它们不可见或不构成内容。
 */
const NEVER_EDITABLE = new Set([
  'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'BASE',
  'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP', 'PROGRESS', 'METER',
  'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'SOURCE', 'TRACK', 'MAP', 'AREA', 'COL', 'PARAM',
  'BR', 'HR',
]);

/** 已知的段落与行内文字标签（快路径，语义上就是「装文字的东西」）。 */
const TEXT_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'P', 'SPAN', 'A', 'BUTTON', 'LABEL', 'SUMMARY',
  'LI', 'DT', 'DD',
  'TD', 'TH', 'CAPTION',
  'BLOCKQUOTE', 'FIGCAPTION', 'PRE', 'CODE',
  'EM', 'STRONG', 'B', 'I', 'U', 'MARK', 'SMALL', 'S', 'CITE', 'Q', 'ABBR', 'TIME',
]);

/**
 * 元素里是否存在「有自己盒子」的子元素（＝装的是块级内容，不是一段文字）。
 *
 * 与 `pick.ts` 的 `hasOwnBox` **同一个判据** —— 那边决定「点下去选中谁」，
 * 这边决定「双击能不能改字」。两处若各写一套，就会出现
 * 「指着 A 选中 B」那类极难归因的不一致（pick.ts 文件头记过这条教训）。
 */
function hasOwnBoxChild(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (hasOwnBox(child)) return true;
  }
  return false;
}

/**
 * 能否就地改字。
 *
 * 🔴 2026-09-23 由「标签白名单」改为**结构性判定**。原因是用户实测反馈：
 *    「它编辑不了容器内的东西」—— 而现实 HTML 里**大量文字就装在裸 `<div>` / `<section>` /
 *    自定义元素里**，白名单天生覆盖不到这些。夹具里 `#inner`（`<div>` 只装文字）改不了字，
 *    就是这个原因。
 *
 * ⚠️ 归因更正：首次跑容器矩阵时另有一条 `#bigbox`(section) 也报失败，我当时把它一起归因成
 *    白名单缺陷 —— **那是错的**。实测几何后发现它的几何中心在视口外（top=819、高 528，
 *    视口只有 800），双击根本没落到元素上。它从来不是白名单的问题。详见
 *    `qa/report/verify-p0-4.md` §8.3。
 *
 * 新规则只有一条闸门：**含「有自己盒子」的子元素 ⇒ 它是容器，不是段落 ⇒ 不可改。**
 * 这样 `<div>纯文字</div>` 可改，而 `<div>文字 <div>子块</div></div>` 仍被拒绝 ——
 * 后者让整块 contenteditable 会把块级结构搅乱（Enter/粘贴都可能重组树）。
 *
 * 嵌套列表这类也要挡住：`<li>` 里若还有 `<ul>`，它不是一段文字。
 */
export function isTextEditable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false; // SVG / MathML 走 P1 图形那条线
  const tag = el.tagName.toUpperCase();
  if (NEVER_EDITABLE.has(tag)) return false;
  if (hasOwnBoxChild(el)) return false;
  if (TEXT_TAGS.has(tag)) return true;
  // 结构上是叶子（只装文字/行内内容），且真的有字可改 —— 那它就是一个段落。
  // 要求「有字」是为了把空 `<div>`、以及 `textContent` 为空的怪东西（`<template>` 等）挡在外面。
  return (el.textContent ?? '').trim().length > 0;
}

export type InlineCommitHandler = (el: Element, nextHtml: string, prevHtml: string) => void;
/** 改字态变化通知（进入时传元素、退出时传 null）——覆盖层靠它画/收虚线框。 */
export type InlineEditingHandler = (el: Element | null) => void;

export interface InlineEditor {
  start(el: Element): void;
  /** 提交（内容变了才回调）。 */
  commit(): void;
  /** 放弃并还原到进入编辑前的内容。 */
  cancel(): void;
  isEditing(): boolean;
  getEditingEl(): Element | null;
}

function placeCaretAtEnd(el: HTMLElement): void {
  const win = el.ownerDocument.defaultView;
  if (!win) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = win.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/** 在当前光标处插入 `<br>` 并把光标移到它后面（Shift+Enter 用）。 */
function insertLineBreak(doc: Document): void {
  const win = doc.defaultView;
  const sel = win?.getSelection();
  if (!win || !sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const br = doc.createElement('br');
  range.insertNode(br);
  range.setStartAfter(br);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function createInlineEditor(
  onCommit: InlineCommitHandler,
  onEditingChange?: InlineEditingHandler,
): InlineEditor {
  let el: HTMLElement | null = null;
  let prevHtml = '';
  let prevContentEditable: string | null = null;
  let prevEditingMarker: string | null = null;
  let detach: (() => void) | null = null;

  function stop(): void {
    detach?.();
    detach = null;
  }

  function start(target: Element): void {
    if (!isTextEditable(target)) return;
    const node = target as HTMLElement;
    if (el === node) return;
    // 同一时刻只允许一个编辑态：先把上一个提交掉，避免两个 contenteditable 并存。
    if (el) commit();

    el = node;
    prevHtml = node.innerHTML;
    prevContentEditable = node.getAttribute('contenteditable');
    prevEditingMarker = node.getAttribute(EP.EDITING_ATTR);

    node.setAttribute('contenteditable', 'true');
    node.setAttribute(EP.EDITING_ATTR, 'true');
    node.focus();
    placeCaretAtEnd(node);

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Enter') {
        // Shift+Enter：元素内换行，不产生新块级元素
        e.preventDefault();
        insertLineBreak(node.ownerDocument);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        node.blur();
      }
    };
    const onPaste = (e: ClipboardEvent): void => {
      // 只收纯文本：否则会把外部页面的标签、样式、脚本片段一起粘进来。
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text) node.ownerDocument.execCommand('insertText', false, text);
    };
    const onBlur = (): void => commit();

    node.addEventListener('keydown', onKeydown);
    node.addEventListener('paste', onPaste);
    node.addEventListener('blur', onBlur);
    detach = () => {
      node.removeEventListener('keydown', onKeydown);
      node.removeEventListener('paste', onPaste);
      node.removeEventListener('blur', onBlur);
    };
    // 放在最后广播：此刻监听器已就位、contenteditable 已生效，外部拿到的状态是「真的能改字了」。
    onEditingChange?.(node);
  }

  function finish(): HTMLElement | null {
    if (!el) return null;
    const node = el;
    stop();
    if (prevContentEditable === null) node.removeAttribute('contenteditable');
    else node.setAttribute('contenteditable', prevContentEditable);
    if (prevEditingMarker === null) node.removeAttribute(EP.EDITING_ATTR);
    else node.setAttribute(EP.EDITING_ATTR, prevEditingMarker);
    prevContentEditable = null;
    prevEditingMarker = null;
    el = null;
    onEditingChange?.(null);
    return node;
  }

  function commit(): void {
    const node = finish();
    if (!node) return;
    const next = node.innerHTML;
    // 用 innerHTML 比较而不是文本：只改了格式（例如粘贴前后浏览器补了个 `<br>`）也算改动。
    // ⚠️ 回调方必须用 **HTML 语义**的命令（`SetHtmlCommand`）落库 —— 传下去的是 innerHTML，
    // 若落到 `SetTextCommand`，它会把这段 HTML 当纯文本写回，页面直接显示源码、标签全丢。
    if (next !== prevHtml) onCommit(node, next, prevHtml);
  }

  function cancel(): void {
    const node = finish();
    if (!node) return;
    node.innerHTML = prevHtml;
  }

  return {
    start,
    commit,
    cancel,
    isEditing: () => el !== null,
    getEditingEl: () => el,
  };
}
