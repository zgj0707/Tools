// 悬浮工具条。
//
// 分组（从左到右）：状态 | 字符格式 | 历史 | 模式与保存。
// 保存按钮覆盖当前 HTML 原件；每次写入前要求用户确认。
//
// 图标按钮的可访问名由视觉隐藏文本承载，图标保持纯装饰。
// 本文件所有名字已逐条对照 `i18n/zh-CN.ts` 的禁用子串清单
// （导入 HTML / 导出 HTML / 复制 HTML / 新建空白 / 预览 / 重置位移 / 格式刷 / 粘贴 HTML /
//  插入与图层 / 样式 / 左 / 右 / 居中 / 顶 / 底 / 水平等距 / 垂直等距 / 继续 / 删除 /
//  确定 / 按钮 / 表格 / 图片 / 取消 / 项目符号列表 / 编号列表），均无命中。
//   —— 特别确认过 `加粗` / `倾斜` / `下划线` / `文字颜色` 四个新名字。
// 主要按钮名：`编辑模式`、`覆盖原件`、`收起工具条` 与上列格式名。

import { TEXT_COLORS, type ToggleFormat } from '../format';
import { EPX, type ExtensionMode } from '../anchors';
import { overwriteTitle } from './toast';

const ICONS = {
  pencil: '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="M14 6l4 4"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h10V3M7 21v-7h10v7"/>',
  bold: '<path stroke-width="2.4" d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path stroke-width="2.4" d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/>',
  italic: '<path d="M15 5h4M5 19h4"/><path d="M14 5 10 19"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.7 1.8-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h1.4a4.7 4.7 0 0 0 4.7-4.7c0-3.7-3.8-6.8-8.5-6.8Z"/><circle cx="8" cy="10" r="1.1"/><circle cx="12" cy="7.5" r="1.1"/><circle cx="16" cy="10" r="1.1"/>',
  undo: '<path d="M8 8H16a5 5 0 0 1 0 10h-6"/><path d="M11.5 4.5 8 8l3.5 3.5"/>',
  redo: '<path d="M16 8H8a5 5 0 0 0 0 10h6"/><path d="M12.5 4.5 16 8l-3.5 3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
} as const;

type ToolbarIcon = keyof typeof ICONS;

function iconButton(
  doc: Document,
  name: ToolbarIcon,
  label: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'ep-btn ep-btn--icon ep-btn--sm';
  button.addEventListener('click', onClick);
  if (title) button.title = title;

  const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.6');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.classList.add('ep-icon');
  icon.innerHTML = ICONS[name];

  const text = doc.createElement('span');
  text.className = 'ep-sr-only';
  text.textContent = label;
  button.append(icon, text);
  return button;
}

export interface BarHandlers {
  onToggleEditMode(): void;
  onHide(): void;
  onToggleFormat(format: ToggleFormat): void;
  onPickColor(color: string): void;
  onUndo(): void;
  onRedo(): void;
  /** 覆盖当前 HTML 原件；每次写入前都会要求用户确认。 */
  onSave(): void;
}

export interface FormatState {
  /** 是否可施加格式（浏览模式、或没选中可格式化的元素时为 false）。 */
  enabled: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** 当前内联颜色；null 表示没设过。 */
  color: string | null;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface SaveState {
  /** 本环境能不能通过 File System Access API 覆盖原件。 */
  available: boolean;
  /** 正在恢复原件句柄或写入时禁用保存按钮。 */
  busy?: boolean;
  /** 不可用时的原因，挂到 `title` 上 —— 用户得知道「为什么点了没用」。 */
  reason?: string;
  /** 当前 HTML 原件名，用于覆盖确认提示。 */
  target?: string;
}

export interface Bar {
  readonly element: HTMLElement;
  setMode(mode: ExtensionMode): void;
  /** 写回链路的可用性（P0-5）。不可用时按钮禁用并把原因写进 title。 */
  setSaveState(state: SaveState): void;
  syncFormat(state: FormatState): void;
  syncHistory(state: HistoryState): void;
  closeColorPopover(): void;
}

const MODE_TEXT: Record<ExtensionMode, string> = {
  browse: '浏览中',
  edit: '编辑中',
};

const TOGGLE_SPEC: ReadonlyArray<{ format: ToggleFormat; icon: 'bold' | 'italic' | 'underline'; label: string; hint: string }> = [
  { format: 'bold', icon: 'bold', label: '加粗', hint: '加粗（Ctrl+B）：选中文字时作用于选区，否则作用于整个元素' },
  { format: 'italic', icon: 'italic', label: '倾斜', hint: '倾斜（Ctrl+I）' },
  { format: 'underline', icon: 'underline', label: '下划线', hint: '下划线（Ctrl+U）' },
];

export function buildBar(doc: Document, handlers: BarHandlers): Bar {
  const bar = doc.createElement('div');
  bar.id = EPX.BAR;
  bar.className = 'ep-ext-bar';
  bar.setAttribute('data-ep-bar', '');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'HTML 编辑工具');
  bar.setAttribute('aria-orientation', 'horizontal');

  // 状态位。文本只是可见反馈，不构成任何按钮的可访问名。
  const state = doc.createElement('span');
  state.className = 'ep-ext-bar__state';
  bar.appendChild(state);

  const sep = (): HTMLSpanElement => {
    const s = doc.createElement('span');
    s.className = 'ep-ext-bar__sep';
    return s;
  };

  const editBtn = iconButton(
    doc,
    'pencil',
    '编辑模式',
    handlers.onToggleEditMode,
    '开启后接管页面点击与键入，用于编辑内容；再点一次回到浏览',
  );
  bar.appendChild(editBtn);

  const saveBtn = iconButton(doc, 'save', '覆盖原件', handlers.onSave);
  bar.appendChild(saveBtn);

  bar.appendChild(sep());

  // ── 字符格式 ──
  const toggleButtons = new Map<ToggleFormat, HTMLButtonElement>();
  for (const spec of TOGGLE_SPEC) {
    const btn = iconButton(doc, spec.icon, spec.label, () => handlers.onToggleFormat(spec.format), spec.hint);
    btn.setAttribute('aria-pressed', 'false');
    toggleButtons.set(spec.format, btn);
    bar.appendChild(btn);
  }

  // 文字颜色：按钮 + 色板浮层。浮层是工具条的绝对定位子元素（`.ep-ext-bar` 自身已是定位元素），
  // 所以它能稳稳贴在工具条下方，且**不吃页面点击**（只在自身范围内接收）。
  const colorBtn = iconButton(doc, 'palette', '文字颜色', () => toggleColorPopover(), '文字颜色');
  // 当前色的指示条：靠 class 挂上，色值由 syncFormat 写内联（它是数据不是主题色）。
  const colorChip = doc.createElement('span');
  colorChip.className = 'ep-ext-bar__chip';
  colorBtn.appendChild(colorChip);
  bar.appendChild(colorBtn);

  const colorPopover = doc.createElement('div');
  colorPopover.className = 'ep-ext-colors';
  colorPopover.setAttribute('data-ep-colors', '');
  colorPopover.setAttribute('data-open', 'false');
  colorPopover.setAttribute('role', 'group');
  colorPopover.setAttribute('aria-label', '文字颜色选择');
  for (const color of TEXT_COLORS) {
    const swatch = doc.createElement('button');
    swatch.type = 'button';
    swatch.className = 'ep-ext-color';
    swatch.dataset.color = color;
    // 色值是写进用户文档的数据，内联在这里是合理的（编辑器主题色才走 token）。
    swatch.style.background = color;
    swatch.title = color;
    // 色块没有可见文字，用视觉隐藏文本提供可访问名。
    const name = doc.createElement('span');
    name.className = 'ep-sr-only';
    name.textContent = `颜色 ${color}`;
    swatch.appendChild(name);
    swatch.addEventListener('click', () => {
      handlers.onPickColor(color);
      closeColorPopover();
    });
    colorPopover.appendChild(swatch);
  }
  bar.appendChild(colorPopover);

  function closeColorPopover(): void {
    colorPopover.setAttribute('data-open', 'false');
  }

  function toggleColorPopover(): void {
    const open = colorPopover.getAttribute('data-open') === 'true';
    colorPopover.setAttribute('data-open', open ? 'false' : 'true');
  }

  bar.appendChild(sep());

  // ── 历史 ──
  const undoBtn = iconButton(doc, 'undo', '撤销', handlers.onUndo, '撤销（Ctrl+Z）');
  const redoBtn = iconButton(doc, 'redo', '重做', handlers.onRedo, '重做（Ctrl+Shift+Z）');
  bar.appendChild(undoBtn);
  bar.appendChild(redoBtn);

  bar.appendChild(sep());

  const hideBtn = iconButton(doc, 'close', '收起工具条', handlers.onHide, '收起工具条（刷新页面即恢复）');
  bar.appendChild(hideBtn);

  const saveInfo: { target: string } = { target: '' };

  function setMode(mode: ExtensionMode): void {
    const on = mode === 'edit';
    editBtn.setAttribute('aria-pressed', String(on));
    editBtn.classList.toggle('ep-btn--active', on);
    state.textContent = MODE_TEXT[mode];
    state.title = on
      ? '编辑模式已开启：页面自身的点击与键入被编辑器接管'
      : '浏览模式：页面行为与未装插件时一致';
  }

  function setSaveState(next: SaveState): void {
    if (next.target !== undefined) saveInfo.target = next.target;
    const busy = next.busy === true;
    saveBtn.disabled = !next.available || busy;
    saveBtn.setAttribute('aria-busy', String(busy));
    saveBtn.dataset.busy = String(busy);
    // 文案统一由 `overwriteTitle` 出（含「不可用」那一档）。
    if (!next.available) {
      saveBtn.title = next.reason ?? overwriteTitle({ available: false });
    } else if (busy) {
      saveBtn.title = next.reason ?? '正在准备保存…';
    } else {
      saveBtn.title = overwriteTitle({ available: true, target: saveInfo.target });
    }
  }

  function syncFormat(next: FormatState): void {
    for (const [format, btn] of toggleButtons) {
      btn.disabled = !next.enabled;
      btn.setAttribute('aria-pressed', String(next[format]));
      btn.classList.toggle('ep-btn--active', next[format]);
    }
    colorBtn.disabled = !next.enabled;
    colorBtn.classList.toggle('ep-btn--active', next.color !== null);
    colorBtn.title = next.color ? `文字颜色（当前 ${next.color}）` : '文字颜色';
    colorChip.style.background = next.color ?? 'transparent';
    colorChip.setAttribute('data-set', next.color ? 'true' : 'false');
    if (!next.enabled) closeColorPopover();
  }

  function syncHistory(next: HistoryState): void {
    undoBtn.disabled = !next.canUndo;
    redoBtn.disabled = !next.canRedo;
  }

  return { element: bar, setMode, setSaveState, syncFormat, syncHistory, closeColorPopover };
}
