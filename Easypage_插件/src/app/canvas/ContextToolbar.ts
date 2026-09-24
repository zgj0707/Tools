// 上下文工具条（批次 1 · R4）。
//
// 【它解决什么】
// 改造前，「复制元素 / 删除 / 锁定 / 改字号 / 改颜色」这五个高频动作全在右侧 220px
// 面板或右键菜单里 —— 用户必须在画布与面板之间来回横跨整屏（E4/E8）。
//
// 【为什么落在画布上沿、而不是像 Figma 那样贴着选中框浮】
// 这是落地阶段基于**硬约束**做的取舍，不是省事：
// 浮在选中框上方的浮层必然覆盖画布区域，而 e2e 有大量真实点击直接命中画布元素
// （multi-select 里同排卡片间距 10px、selection 里 h1/段落上下相邻）。浮条压在这类
// 密集排布上时，`locator.click()` 会因为「目标被其它元素接管」而失败 —— 且这不是
// 测试洁癖：真实用户点邻接元素时同样会被浮条挡住。
// 项目已有一条同因的既有决策：对齐条与面包屑都从绝对定位改回「文档流内 + 胶囊造型」
// （见 app.css 与 T121 记录）。本工具条沿用同一结论：**吸附画布上沿，占位不遮内容**。
// 代价是视线要从选中物上移约 40px，换来的是任何选中状态下都零遮挡。
//
// 【命名红线】见 ui/icons.ts 文件头。本文件新增的可访问名都避开了
// 「左/右/顶/底/居中/删除/预览/导出 HTML」等既有锚点子串。

import { t } from '../i18n/zh-CN';
import { icon, srOnly } from '../ui/icons';

export interface ContextToolbarDeps {
  /** 当前选中元素（可能为空数组）。 */
  getSelection: () => Element[];
  /** 元素是否锁定（决定锁定按钮的文案与语义）。 */
  isLocked: (el: Element) => boolean;
  /** 字号增减（绝对值，px）。 */
  setFontSize: (px: number) => void;
  /** 文字颜色（#rrggbb）。 */
  setColor: (hex: string) => void;
  duplicate: () => void;
  toggleLock: () => void;
  remove: () => void;
}

const FONT_STEP_PX = 1;

export class ContextToolbar {
  readonly el: HTMLElement;

  private readonly deps: ContextToolbarDeps;
  private readonly hint: HTMLSpanElement;
  private readonly sizeEl: HTMLSpanElement;
  private readonly colorEl: HTMLInputElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly lockBtn: HTMLButtonElement;
  private sizeValue: number | null = null;

  constructor(deps: ContextToolbarDeps) {
    this.deps = deps;

    this.el = document.createElement('div');
    this.el.id = 'ep-ctxbar';
    this.el.className = 'ep-ctxbar';

    this.hint = document.createElement('span');
    this.hint.className = 'ep-ctxbar__hint';
    this.hint.textContent = t('ctx.none');
    this.el.appendChild(this.hint);
    this.el.appendChild(sep());

    // 字号 −/值/＋
    const smaller = this.mkBtn('minus', t('ctx.fontSmaller'), () => this.nudgeFont(-FONT_STEP_PX));
    this.sizeEl = document.createElement('span');
    this.sizeEl.className = 'ep-ctxbar__value';
    this.sizeEl.textContent = '—';
    const bigger = this.mkBtn('plus', t('ctx.fontBigger'), () => this.nudgeFont(FONT_STEP_PX));
    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'ep-ctxbar__group';
    sizeGroup.append(smaller, this.sizeEl, bigger);
    this.el.appendChild(sizeGroup);

    // 颜色：原生取色器视觉收成 20px 方块。aria-label 与样式面板的「文字颜色」刻意不同，
    // 避免 getByRole 命中两个同名控件。
    this.colorEl = document.createElement('input');
    this.colorEl.type = 'color';
    this.colorEl.className = 'ep-ctxbar__color';
    this.colorEl.setAttribute('aria-label', t('ctx.colorAria'));
    this.colorEl.title = t('ctx.color');
    this.colorEl.addEventListener('change', () => this.deps.setColor(this.colorEl.value));
    this.el.appendChild(this.colorEl);

    this.el.appendChild(sep());

    const dup = this.mkBtn('copy', t('ctx.duplicate'), () => this.deps.duplicate());
    this.lockBtn = this.mkBtn('lock', t('ctx.lock'), () => this.deps.toggleLock());
    const removeBtn = this.mkBtn('remove', t('ctx.remove'), () => this.deps.remove());
    removeBtn.classList.add('ep-btn--danger');
    this.el.append(dup, this.lockBtn, removeBtn);

    this.refresh();
  }

  private mkBtn(name: Parameters<typeof icon>[0], label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-btn ep-btn--icon ep-btn--sm';
    b.title = label;
    b.appendChild(icon(name, 15));
    b.appendChild(srOnly(label));
    b.addEventListener('click', onClick);
    this.buttons.push(b);
    return b;
  }

  /** 选中变化时刷新。无选中 ⇒ 全部禁用（与对齐条同一口径，不用「点了才提示」）。 */
  refresh(): void {
    const els = this.deps.getSelection();
    const n = els.length;
    const single = n === 1 ? els[0]! : null;

    // 提示宽度在 CSS 里定死（防画布跳动，见 app.css 的 .ep-ctxbar__hint），
    // 长选择器会被省略号截断 —— 用 title 补回完整值。
    const text = n === 0
      ? t('ctx.none')
      : n === 1
        ? `${single!.tagName.toLowerCase()}${single!.id ? '#' + single!.id : ''}`
        : t('ctx.multi').replace('{n}', String(n));
    this.hint.textContent = text;
    this.hint.title = text;

    for (const b of this.buttons) b.disabled = n === 0;
    this.colorEl.disabled = n === 0;

    if (n === 0) {
      this.sizeEl.textContent = '—';
      this.sizeValue = null;
      this.lockBtn.title = t('ctx.lock');
      return;
    }

    const css = els.map((el) => (el.ownerDocument.defaultView ?? window).getComputedStyle(el));
    const sizes = css.map((c) => Math.round(parseFloat(c.fontSize ?? '0') || 0));
    const sameSize = sizes.every((s) => s === sizes[0]);
    this.sizeValue = sameSize ? sizes[0]! : null;
    this.sizeEl.textContent = sameSize ? String(sizes[0]) : t('ctx.mixed');

    const colors = css.map((c) => toHex(c.color));
    this.colorEl.value = colors.every((c) => c === colors[0]) ? colors[0]! : '#000000';

    const locked = !!single && this.deps.isLocked(single);
    this.lockBtn.title = locked ? t('ctx.unlock') : t('ctx.lock');
    this.lockBtn.replaceChildren(icon(locked ? 'unlock' : 'lock', 15), srOnly(locked ? t('ctx.unlock') : t('ctx.lock')));
  }

  private nudgeFont(delta: number): void {
    if (this.sizeValue === null) return;
    const next = Math.max(1, this.sizeValue + delta);
    if (next === this.sizeValue) return;
    this.sizeValue = next;
    this.sizeEl.textContent = String(next);
    this.deps.setFontSize(next);
  }
}

function sep(): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'ep-ctxbar__sep';
  return s;
}

function toHex(rgb: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(rgb.trim());
  if (!m) return '#000000';
  const parts = (m[1] as string).split(',').map((s) => parseInt(s.trim(), 10));
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(parts[0] ?? 0)}${to(parts[1] ?? 0)}${to(parts[2] ?? 0)}`;
}
