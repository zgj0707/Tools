// 布局状态（T121）：左右面板的开合是「用户偏好」，跨会话记忆。
// 默认收起 —— 这是方案 C「画布优先」的核心：界面存在感最低，画布占满视野。
//
// 【为什么用 localStorage 而不是内存态】
// 面板开合持久化本身就是用户预期（Figma / Notion / Canva 都记），属于真实功能；
// 顺带让 e2e 能用 storageState 统一预置「面板展开」这一前置条件，
// 避免为 21 个 spec 逐条改写「元素常驻可见」类断言。

export interface UiLayoutState {
  left: boolean;
  right: boolean;
}

const KEY = 'easypage:layout';

/** 默认收起。 */
export const DEFAULT_LAYOUT: UiLayoutState = { left: false, right: false };

export function loadLayout(): UiLayoutState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const rec = JSON.parse(raw) as Partial<UiLayoutState>;
    return { left: rec.left === true, right: rec.right === true };
  } catch {
    // localStorage 可能因 file:// 或隐私模式不可用，回落默认值，不影响编辑能力
    return { ...DEFAULT_LAYOUT };
  }
}

export function persistLayout(state: UiLayoutState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

/** e2e / 度量脚本预置布局时使用的键名与取值，避免字面量散落。 */
export const LAYOUT_STORAGE_KEY = KEY;
export const LAYOUT_OPEN_ALL = JSON.stringify({ left: true, right: true });
