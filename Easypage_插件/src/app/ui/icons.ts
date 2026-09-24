// 内联 SVG 图标集（批次 1 · R5）。
//
// 【为什么不引图标库】产品要求「零外链 / 单文件可跑」（见 README 执行指南与
// docs/plan/06 §6），引任何图标库都会把体积和外链同时推高。全部图标在此手写为
// 24×24 viewBox 的 stroke 路径，颜色走 currentColor，跟随按钮文字色自动适配。
//
// 【可访问名红线 —— 改名前必读】
// e2e 用 `getByRole('button', { name })` 定位，而 **name 是子串匹配**（T122 已踩）。
// 因此：
//   ① 图标按钮的文字一律放进 `.ep-sr-only` span。文本仍在可访问性树内 ⇒ 定位锚点保住；
//      视觉上被裁成 0×0 ⇒ 不产生噪声。
//   ② 绝不用 aria-label 写文案 —— 它会**覆盖** span 文本成为可访问名，污染锚点。
//   ③ 新增按钮文案前先查 src/app/i18n/zh-CN.ts 顶部的禁用子串清单。
//
// 【子串冲突实例（真实存在，勿踩）】
//   对齐按钮的可访问名是「左」「右」「居中」「顶」「底」。任何新按钮的名字若含这些字
//   （如「左上」「右对齐」），multi-select.spec 的 `getByRole('button', {name:'左'})`
//   会一次命中两个元素 → strict mode 违规。同理禁含「删除」（shortcuts.spec 用
//   `getByText('删除', { exact: true })` 点右键菜单项，任何文本恰为「删除」的新节点都会撞车）。

export type IconName =
  | 'paste'
  | 'filePlus'
  | 'play'
  | 'pencil'
  | 'download'
  | 'copy'
  | 'resetMove'
  | 'brush'
  | 'panelLeft'
  | 'panelRight'
  | 'undo'
  | 'redo'
  | 'alignLeft'
  | 'alignRight'
  | 'alignHCenter'
  | 'alignTop'
  | 'alignBottom'
  | 'alignVCenter'
  | 'distributeH'
  | 'distributeV'
  | 'minus'
  | 'plus'
  | 'palette'
  | 'lock'
  | 'unlock'
  | 'remove'
  | 'close'
  | 'fitWidth'
  | 'zoomReset'
  | 'phone'
  | 'tablet'
  | 'desktop'
  | 'fullWidth'
  | 'bold'
  | 'italic'
  | 'underline';

/**
 * 每个图标是若干 SVG 子节点（path / line / rect / circle）的字符串。
 * 统一约定：24×24 viewBox、`stroke="currentColor"`、无填充、圆角线帽。
 */
const PATHS: Record<IconName, string> = {
  paste:
    '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z"/>' +
    '<path d="M8 6H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2"/>' +
    '<path d="M7 11h6M7 15h8"/>',
  filePlus:
    '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z"/>' +
    '<path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
  // 编辑模式开关（P0-1 插件工具条）。笔尖朝左下，与「改内容」的语义一致。
  pencil: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="M14 6l4 4"/>',
  download: '<path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19h16"/>',
  copy:
    '<rect x="9" y="9" width="11" height="11" rx="1.5"/>' +
    '<path d="M15 6.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1.5"/>',
  resetMove:
    '<path d="M4 9h11a5 5 0 0 1 0 10H8"/><path d="M7.5 5.5 4 9l3.5 3.5"/>',
  brush:
    '<path d="M4 20c2.5 0 4-1.4 4-4 0-1.2-.9-2-2-2s-2 .9-2 2c0 .9-.5 1.6-1.4 2 .4 1.3 1 2 2.4 2Z"/>' +
    '<path d="M10.5 14.5 19 6a1.8 1.8 0 0 0-2.6-2.6L8 11.9"/>',
  panelLeft:
    '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
  panelRight:
    '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
  undo: '<path d="M8 8H16a5 5 0 0 1 0 10h-6"/><path d="M11.5 4.5 8 8l3.5 3.5"/>',
  redo: '<path d="M16 8H8a5 5 0 0 0 0 10h6"/><path d="M12.5 4.5 16 8l-3.5 3.5"/>',
  alignLeft: '<path d="M4 4v16"/><rect x="7.5" y="7" width="10" height="3.5" rx="1"/><rect x="7.5" y="13.5" width="6" height="3.5" rx="1"/>',
  alignRight: '<path d="M20 4v16"/><rect x="6.5" y="7" width="10" height="3.5" rx="1"/><rect x="10.5" y="13.5" width="6" height="3.5" rx="1"/>',
  alignHCenter: '<path d="M12 3v18"/><rect x="5.5" y="7" width="13" height="3.5" rx="1"/><rect x="7.5" y="13.5" width="9" height="3.5" rx="1"/>',
  alignTop: '<path d="M4 4h16"/><rect x="7" y="7.5" width="3.5" height="10" rx="1"/><rect x="13.5" y="7.5" width="3.5" height="6" rx="1"/>',
  alignBottom: '<path d="M4 20h16"/><rect x="7" y="6.5" width="3.5" height="10" rx="1"/><rect x="13.5" y="10.5" width="3.5" height="6" rx="1"/>',
  alignVCenter: '<path d="M3 12h18"/><rect x="7" y="5.5" width="3.5" height="13" rx="1"/><rect x="13.5" y="7.5" width="3.5" height="9" rx="1"/>',
  distributeH:
    '<path d="M4 4v16M20 4v16"/><rect x="10.5" y="7" width="3" height="10" rx="1"/>' +
    '<path d="M7 12h1.5M15.5 12H17"/>',
  distributeV:
    '<path d="M4 4h16M4 20h16"/><rect x="7" y="10.5" width="10" height="3" rx="1"/>' +
    '<path d="M12 7v1.5M12 15.5V17"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  palette:
    '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.7 1.8-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.4a4.7 4.7 0 0 0 4.7-4.7c0-3.7-3.8-6.8-8.5-6.8Z"/>' +
    '<circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/><circle cx="16" cy="10" r="1.1"/>',
  lock:
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock:
    '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  remove:
    '<path d="M5 7h14"/><path d="M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/>' +
    '<path d="M6.5 7l.8 12a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.8-12"/>' +
    '<path d="M10.5 11v5M13.5 11v5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  fitWidth:
    '<path d="M4 5v14M20 5v14"/><path d="M8 12h8"/><path d="M10.5 9.5 8 12l2.5 2.5M13.5 9.5 16 12l-2.5 2.5"/>',
  zoomReset:
    '<rect x="4" y="5" width="16" height="12" rx="1.5"/><path d="M8 20h8"/>' +
    '<path d="M9.5 11h5"/>',
  phone: '<rect x="7.5" y="3" width="9" height="18" rx="2"/><path d="M11 6h2"/>',
  tablet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 17.5h2"/>',
  desktop: '<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16.5V20"/>',
  fullWidth:
    '<rect x="2.5" y="5" width="19" height="13" rx="1.5"/>' +
    '<path d="M6 12h12"/><path d="M8.5 9.5 6 12l2.5 2.5M15.5 9.5 18 12l-2.5 2.5"/>',
  // 字符格式三件套（P0-4）。B 的两道弧线刻意加粗到 2.4 —— 与相邻的 I / U 相比，
  // 细描边的 B 在 16px 下会糊成一团，失去「粗体」的视觉暗示。
  bold: '<path stroke-width="2.4" d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path stroke-width="2.4" d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/>',
  italic: '<path d="M15 5h4M5 19h4"/><path d="M14 5 10 19"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 生成一个图标节点。size 为视觉边长（正方形），stroke 宽度按 24 网格等比缩放。 */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // 图标纯装饰：可访问名由同级 sr-only 文本承担，避免重复朗读
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ep-icon');
  svg.innerHTML = PATHS[name];
  return svg;
}

/** 只读文本（视觉隐藏、仍在可访问性树内）。见文件头「可访问名红线」。 */
export function srOnly(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'ep-sr-only';
  s.textContent = text;
  return s;
}

export interface IconButtonOptions {
  /** 图标名。 */
  icon: IconName;
  /** 可访问名（= e2e 定位锚点）。必填，且必须查过 i18n 的禁用子串清单。 */
  label: string;
  /** hover 提示。写 title 而不是 aria-label —— 后者会污染可访问名。 */
  title?: string;
  /** 是否显示文字（默认 false：纯图标 + sr-only）。 */
  withText?: boolean;
  /** 尺寸：'md' 走 .ep-btn 高度，'sm' 用于工具条内。 */
  size?: 'md' | 'sm';
  onClick?: () => void;
}

/**
 * 图标按钮工厂。结构：`<button class="ep-btn ep-btn--icon">[svg]<span class="ep-sr-only">文案</span></button>`
 *
 * `withText` 为 true 时把文案直接显示出来（用于对齐条这类需要一秒读懂的场景），
 * 此时文案仍只有一份，可访问名不变。
 */
export function iconButton(opts: IconButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  // 三种形态由类名区分，样式见 app.css：
  //   .ep-btn--icon                 紧凑方形（纯图标）
  //   .ep-btn--icon.ep-btn--icontext 自适应宽度（图标 + 可见文案）
  //   .ep-btn--sm                   工具条内的 24px 变体
  btn.className = 'ep-btn ep-btn--icon'
    + (opts.withText ? ' ep-btn--icontext' : '')
    + (opts.size === 'sm' ? ' ep-btn--sm' : '');
  btn.appendChild(icon(opts.icon));
  if (opts.withText) {
    const txt = document.createElement('span');
    txt.className = 'ep-btn__text';
    txt.textContent = opts.label;
    btn.appendChild(txt);
  } else {
    btn.appendChild(srOnly(opts.label));
  }
  if (opts.title) btn.title = opts.title;
  if (opts.onClick) btn.addEventListener('click', () => opts.onClick!());
  return btn;
}
