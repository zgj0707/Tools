// 视图偏好（批次 1 · R2 缩放 + R7 面板分组）。
//
// 【为什么单独一个文件、而不是塞进 UiLayout】
// UiLayout 管的是「左右面板开合」——它是布局结构；本文件管的是「画布怎么缩放、
// 属性分组哪几组展开」——它是视图偏好。二者的持久化键、默认值、消费者都不同，
// 合并会让任一方的默认值改动牵动另一方。保持分开，读者一眼能定位。
//
// 【为什么 e2e 要预置这两项】
// 与 playwright.config.ts 里「预置面板已展开」同因：绝大多数用例的真实意图是
// 「当我用面板/画布做 X，应当得到 Y」，而不是「画布的初始缩放比是多少」
// 「属性面板默认展开哪几组」。把这两项在测试前置里钉死为确定值，可以让
// ① 依赖画布坐标的 20+ 处几何断言继续成立（autoFit=false ⇒ 缩放恒 1 ⇒ 零几何变化）；
// ② 依赖 `.ep-box` / `.ep-deco` 字段常驻可交互的断言继续成立（分组全展开）。
// 「默认是否自动适应宽度」「默认展开哪几组」由专门的 spec 覆盖。

export interface ViewPrefs {
  /**
   * 面板开合 / 窗口尺寸变化时，是否自动把画布缩放比调到「整页宽度尽收眼底」。
   * 用户一旦手动改过缩放（点缩放控件或按快捷键），即视为接管，本项自动置 false。
   */
  autoFit: boolean;
  /** 属性面板各分组的展开态，键为分组 id（text / box / deco）。 */
  sections: Record<string, boolean>;
}

const KEY = 'easypage:view';

/**
 * 生产默认：只展开「文字」组。
 * 依据是 E4 实测 —— 三组全展开时面板内容高 1221px，1440 视口下要滚动 45%。
 * 「按需显形」是 Figma 式属性面板的基本盘，不是隐藏功能。
 */
export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  autoFit: true,
  sections: { text: true, box: false, deco: false },
};

export function loadViewPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_VIEW_PREFS, sections: { ...DEFAULT_VIEW_PREFS.sections } };
    const rec = JSON.parse(raw) as Partial<ViewPrefs>;
    return {
      autoFit: rec.autoFit !== false,
      sections: { ...DEFAULT_VIEW_PREFS.sections, ...(rec.sections ?? {}) },
    };
  } catch {
    // localStorage 可能因 file:// 或隐私模式不可用，回落默认值，不影响编辑能力
    return { ...DEFAULT_VIEW_PREFS, sections: { ...DEFAULT_VIEW_PREFS.sections } };
  }
}

export function persistViewPrefs(patch: Partial<ViewPrefs>): ViewPrefs {
  const next: ViewPrefs = { ...loadViewPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
  return next;
}

/** e2e / 度量脚本预置视图偏好时使用的键名与取值，避免字面量散落。 */
export const VIEW_STORAGE_KEY = KEY;
/** 测试前置：关闭自动适应（锁死缩放为 1），并让属性三组全部展开。 */
export const VIEW_E2E_PRESET = JSON.stringify({
  autoFit: false,
  sections: { text: true, box: true, deco: true },
});
