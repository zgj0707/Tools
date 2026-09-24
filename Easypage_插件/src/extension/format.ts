// 字符格式（P0-4）：加粗 / 倾斜 / 下划线 / 文字颜色。
//
// 按「有没有选中文字」分流成两条路径 —— 这正是 Word 的行为：
//   ① 就地编辑中选中了一段文字 ⇒ 把选区包成 `<strong>` / `<em>` / `<u>`（字符级，精确到词）；
//      若选区**已经**被同一个标签完整包着，再点一次就是取消（解包）。
//   ② 没有选区（只是选中了元素）⇒ 改元素自身的内联样式（段级）。
//
// 两条路径都直接复用现成的可撤销命令（`InlineWrapCommand` / `SetStyleCommand`），
// **没有新增任何命令类** —— 撤销/重做的语义因此与旧形态完全一致。
//
// ⚠️ toggle 的「当前是否已开启」只读**内联样式**，不读计算样式：
// 计算样式会被祖先继承污染（父级加粗时子元素也算加粗），于是点一下会「没反应」。
// 只读内联样式的代价是：页面原本靠 class 加粗的元素，第一次点会重复设一次 700
// （视觉无变化），第二次才取消。这个代价换来的是「我写什么就读什么」的可预测性。

import { SetStyleCommand } from '../core/commands/commands';
import { InlineWrapCommand } from '../core/commands/inlineCommands';
import { checkSelection, findEnclosingWrap, type InlineTag } from '../core/inline/wrapInline';
import type { HistoryStack } from '../core/ports';

export type ToggleFormat = 'bold' | 'italic' | 'underline';

/** 无选区时改哪个内联属性，以及「开启」时的值。key 必须是 camelCase（SetStyleCommand 的约定）。 */
const ELEMENT_SPEC: Record<ToggleFormat, { prop: string; on: string }> = {
  bold: { prop: 'fontWeight', on: '700' },
  italic: { prop: 'fontStyle', on: 'italic' },
  underline: { prop: 'textDecorationLine', on: 'underline' },
};

/** 有选区时包成什么标签。 */
const WRAP_TAG: Record<ToggleFormat, InlineTag> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
};

/** 文字颜色的预设色板。这是写进用户文档的**数据**，不是编辑器 UI 配色，故不进 tokens.css。 */
export const TEXT_COLORS: readonly string[] = [
  '#1f1f1e',
  '#c0392b',
  '#d97706',
  '#1a7f37',
  '#165dff',
  '#7c3aed',
  '#6b7280',
  '#ffffff',
];

/** `CSSStyleDeclaration` 的 camelCase 索引访问（运行时成立，类型上需要绕一道）。 */
function styleOf(el: Element): Record<string, string> {
  return (el as HTMLElement).style as unknown as Record<string, string>;
}

/** 能否对它施加文字格式（SVG 走图形那条线，不在本模块范围）。 */
export function canApplyTextFormat(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement;
}

export function isFormatOn(el: Element | null, format: ToggleFormat): boolean {
  if (!canApplyTextFormat(el)) return false;
  const raw = styleOf(el)[ELEMENT_SPEC[format].prop] ?? '';
  const v = String(raw).toLowerCase();
  if (format === 'bold') return v === 'bold' || v === 'bolder' || Number.parseInt(v, 10) >= 600;
  if (format === 'italic') return v === 'italic' || v === 'oblique';
  return v.includes('underline');
}

/**
 * 有文字选区时走字符级。返回 true 表示「已按字符级处理」，调用方不必再走段级。
 * 没有选区、或选区不合法（跨节点 / 全空白）时返回 false，回落段级。
 */
function toggleViaSelection(format: ToggleFormat, history: HistoryStack): boolean {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  // 🔴 折叠光标（只是「插了个光标」而不是「选中了文字」）必须走元素级。
  // 漏掉这一条会踩一个很隐蔽的坑：点一下加粗的词，光标落在那个 `<strong>` 里，
  // 此时按 Ctrl+B —— `findEnclosingWrap` 会认出「选区被同 tag 完整包着」而**解包**，
  // 于是用户以为「加粗整段」，结果那一个词反而被取消加粗了。
  if (range.collapsed) return false;
  const tag = WRAP_TAG[format];

  const enclosing = findEnclosingWrap(range, tag);
  if (enclosing) {
    history.push(InlineWrapCommand.unwrap(enclosing));
    return true;
  }
  if (!checkSelection(range).ok) return false;
  history.push(
    InlineWrapCommand.wrap(range.startContainer as Text, range.startOffset, range.endOffset, tag),
  );
  return true;
}

/** 切换一个字符格式。有选区作用于选区，否则作用于整个选中元素。 */
export function toggleFormat(format: ToggleFormat, el: Element | null, history: HistoryStack): void {
  if (toggleViaSelection(format, history)) return;
  if (!canApplyTextFormat(el)) return;

  const spec = ELEMENT_SPEC[format];
  const on = !isFormatOn(el, format);
  const prev = styleOf(el)[spec.prop] ?? '';
  history.push(
    new SetStyleCommand([el], { [spec.prop]: on ? spec.on : '' }, new Map([[el, { [spec.prop]: prev }]])),
  );
}

/** 设置选中元素的文字颜色。 */
export function setTextColor(el: Element | null, color: string, history: HistoryStack): void {
  if (!canApplyTextFormat(el)) return;
  const prev = styleOf(el).color ?? '';
  history.push(new SetStyleCommand([el], { color }, new Map([[el, { color: prev }]])));
}
