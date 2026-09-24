// 全局常量（契约 01 §6），唯一来源，禁止在代码里写魔法数字
export const EP = {
  APP_ROOT: 'ep-app',
  OVERLAY_ROOT: 'ep-overlay-root',
  CANVAS_FRAME: 'ep-canvas-frame',
  PREVIEW_FRAME: 'ep-preview-frame',
  CANVAS_DOC_HOST: 'ep-canvas-doc',
  EDITING_ATTR: 'data-ep-editing', // 就地编辑临时标记，提交即删
  CLASS_PREFIX: 'ep-', // 外壳类名前缀（BEM：ep-ribbon__btn--primary）
} as const;

export const INTERACTION = {
  DRAG_DEAD_ZONE_PX: 5, // ≤5px 抖动视为点击，不拖拽
  EDGE_HANDLE_PX: 10, // 元素边缘 10px 内始终可拖；内部含文字默认选字
  SNAP_THRESHOLD_PX: 6, // 边/中线吸附阈值
  EQUAL_SPACE_PX: 4, // 等距检测误差
  MIN_BOX_PX: 16, // 缩放最小宽/高
  NUDGE_PX: 1, // 方向键微移
  NUDGE_BIG_PX: 10, // Shift+方向键
} as const;

export const PERF = {
  POINTER_USE_RAAF: true, // 高频指针计算一律 requestAnimationFrame
  LARGE_PAGE_NODES: 15000, // 超过则提示并允许只读降级（PoC 校准）
} as const;

export const UI = {
  TOAST_VISIBLE_MS: 2600, // 提示条自动收起时长（T122：原为永不隐藏）
} as const;

/**
 * 视图层常量（批次 1 · R2 缩放）。
 *
 * DESIGN_WIDTH 是「适应宽度」的参照视口宽：面板展开挤窄画布时，把被编辑页面
 * 按 1200px（主流桌面版心）渲染、再整体缩放塞进可用宽度，用户看到的仍是完整版面，
 * 而不是被 reflow 成手机版的窄列。
 */
export const VIEW = {
  DESIGN_WIDTH: 1200,
  ZOOM_MIN: 0.25,
  ZOOM_MAX: 2,
  ZOOM_STEP: 0.1,
} as const;
