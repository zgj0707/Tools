// 插件形态的稳定锚点（与 src/constants.ts 同性质、同纪律：**改名即回归**）。
//
// 为什么单开一个文件而不复用 src/constants.ts 的 `EP`：
// `EP` 描述的是「独立应用 + iframe 宿主」那套结构的锚点（`ep-canvas-frame`、
// `ep-preview-frame`、`ep-canvas-doc`），插件形态下多数不再存在。混在一起会让
// 「哪些锚点还有效」变成靠记忆判断的问题。这里只登记插件形态**真实存在**的锚点。

export const EPX = {
  /**
   * Shadow 宿主（light DOM 里编辑器唯一的节点）。
   * e2e 断言「页面没被污染」时就查 `document.querySelectorAll('#ep-root')` 是否为 1。
   */
  ROOT: 'ep-root',

  /**
   * Light DOM 标记：独立浏览器扩展与嵌入式脚本可能同时加载。
   * 两个执行环境共享页面 DOM，但不共享 JS 全局变量；用这个标记避免挂两套工具条。
   */
  HOST_MARKER_ATTR: 'data-easypage-editor-host',

  /**
   * Shadow 内部的 UI 坐标系容器。**刻意不叫 `ep-app`**：
   * `app.css` 的 `#ep-app` 是全视口外壳（`height:100%` + `overflow:hidden` + 不透明底），
   * 插件里编辑器是浮层不是全屏应用，挂进去会立刻盖住用户页面。
   * 详见 src/extension/style/toolbar.css。
   */
  UI: 'ep-ui',

  /** 悬浮工具条。 */
  BAR: 'ep-ext-bar',

  /** 覆盖层坐标系容器（Shadow 内）。hover / 选中框都是它的子节点。 */
  OVERLAY: 'ep-overlay',

  /**
   * hover 高亮框 / 选中框。
   *
   * 🔴 **刻意沿用 `app.css` 里同名的 id**：那两条规则是顶层 ID 选择器
   * （`#ep-hover-box{...}` / `#ep-selected-box{...}`，不挂在 `#ep-overlay-root` 之下），
   * 而 Shadow DOM 里 id 是天然的命名空间 ⇒ 同名即命中，样式零改动复用。
   * 其中包含 `#ep-hover-box[data-fill='false']{background:none}` ——
   * 那是治「蓝色框盖住整页」（T123）的那条规则，必须原样继承。
   */
  HOVER_BOX: 'ep-hover-box',
  SELECTED_BOX: 'ep-selected-box',

  /**
   * 就地改字框（P0-4 补）。
   *
   * 为什么必须有它：改字态原先**没有任何可见提示** —— 截图里「选中某段」与「正在改这段的字」
   * 长得一模一样，用户看不出自己已经进了编辑态（也就不知道 Enter 会提交、Esc 会撤销）。
   * 这是 P0-4 验收时发现的真实缺口，不是锦上添花。
   *
   * ⚠️ 用**虚线**、且刻意不复用 `#ep-selected-box` 加属性 —— 两者必须能同时出现：
   * 改字时选中框仍在（表示「改的是这一块」），虚线框叠加表示「正在改」。
   */
  EDIT_BOX: 'ep-edit-box',

  /**
   * 宿主上的编辑模式状态位：`'browse' | 'edit'`。
   * ⚠️ 刻意不复用 `constants.ts` 的 `data-ep-editing` —— 那个属性是就地文本编辑
   * 打到被编辑元素上的**临时标记**，`stripArtifacts` 与「导出无 ep- 残留」断言都认它。
   * 两者同名会让「编辑模式开着」被误判成「有一处编辑残留」。
   */
  MODE_ATTR: 'data-ep-mode',
} as const;

export type ExtensionMode = 'browse' | 'edit';
