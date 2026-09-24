// 配置驱动快捷键表（T114）：纯函数判定，便于单测。
// 不绑定 DOM，只做 key 字符串 → action 映射与焦点守卫。

export type Action =
  | 'undo' | 'redo' | 'save' | 'open' | 'delete'
  | 'duplicate' | 'toggleLock' | 'nudge' | 'escape'
  | 'bold' | 'italic' | 'underline' | 'link'
  | 'none';

export interface KeyCombo {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** 把 KeyboardEvent-like 归一化为 KeyCombo。 */
export function normalize(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): KeyCombo {
  return {
    key: e.key.toLowerCase(),
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}
/** combo → action 表。 */
export function matchAction(c: KeyCombo): Action {
  if (c.ctrl && !c.shift && !c.alt && c.key === 'z') return 'undo';
  if (c.ctrl && c.shift && !c.alt && c.key === 'z') return 'redo';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'y') return 'redo';
  if (c.ctrl && !c.shift && !c.alt && c.key === 's') return 'save';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'o') return 'open';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'd') return 'duplicate';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'l') return 'toggleLock';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'b') return 'bold';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'i') return 'italic';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'u') return 'underline';
  if (c.ctrl && !c.shift && !c.alt && c.key === 'k') return 'link';
  if (!c.ctrl && !c.alt && (c.key === 'delete' || c.key === 'backspace')) return 'delete';
  if (!c.ctrl && !c.alt && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(c.key)) return 'nudge';
  if (c.key === 'escape') return 'escape';
  return 'none';
}

/** 焦点守卫：在输入控件内不劫持元素操作。 */
export function isEditingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
  return (target as HTMLElement).isContentEditable === true
    || (target as Element).getAttribute('contenteditable') === 'true';
}

/** 目标类型分类。 */
export type TargetKind = 'input' | 'contenteditable' | 'none';

export function classifyTarget(target: EventTarget | null): TargetKind {
  if (!target || !(target instanceof Element)) return 'none';
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return 'input';
  if ((target as HTMLElement).isContentEditable === true || (target as Element).getAttribute('contenteditable') === 'true') return 'contenteditable';
  return 'none';
}

/**
 * 守卫分流：返回是否应该 preventDefault 并执行 action，或放行给浏览器。
 * - save/open：全局拦截，始终执行。
 * - input 控件：除 save/open 外全部放行。
 * - contenteditable：bold/italic/underline/link 与 undo/redo 执行选区命令与命令历史；其余放行给浏览器原生编辑。
 * - none：正常执行。
 */
export function resolveGuard(action: Action, kind: TargetKind): { execute: boolean; prevent: boolean; toastRich?: boolean } {
  if (action === 'save' || action === 'open') return { execute: true, prevent: true };
  if (kind === 'input') return { execute: false, prevent: false };
  if (kind === 'contenteditable') {
    if (action === 'bold' || action === 'italic' || action === 'underline' || action === 'link') {
      return { execute: true, prevent: true };
    }
    if (action === 'undo' || action === 'redo') {
      return { execute: true, prevent: true };
    }
    return { execute: false, prevent: false };
  }
  return { execute: true, prevent: true };
}
