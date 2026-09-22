// 外观区（T109）：border 三分量、radius、box-shadow 五输入+开关、opacity。外壳 ep- 节点。
// T122：① 标签本地化，英文 CSS 属性名退到 label.title；
//       ② 阴影开关语义反转 —— 原实现是「无阴影」勾选框（勾上=移除 shadow），但五个阴影输入
//          不随之禁用，在勾选状态下改模糊/扩散会静默 no-op（rebuild 里直接 commit('')）。
//          现改为「阴影」勾选框（勾上=启用），未勾选时五个输入禁用，状态自洽。
import { t } from '../../i18n/zh-CN';
import { buildShadow, parseShadow } from '../../../core/style/boxProps';
import { makeColor, makeNumber, makeSelect, hintField } from './fields';
import type { BoxCommit } from './BoxModelSection';

export class DecorationSection {
  readonly root: HTMLElement;
  private borderWidth = makeNumber(t('panel.style.deco.borderWidth'), 0, 40, 1);
  private borderStyle = makeSelect(
    t('panel.style.deco.borderStyle'),
    [
      { value: 'none', label: t('panel.style.borderStyle.none') },
      { value: 'solid', label: t('panel.style.borderStyle.solid') },
      { value: 'dashed', label: t('panel.style.borderStyle.dashed') },
      { value: 'dotted', label: t('panel.style.borderStyle.dotted') },
    ],
    '',
  );
  private borderColor = makeColor(t('panel.style.deco.borderColor'));
  private radius = makeNumber(t('panel.style.deco.radius'), 0, 100, 1);
  private opacity = makeNumber(t('panel.style.deco.opacity'), 0, 1, 0.05);
  private shadowX = makeNumber(t('panel.style.deco.shadowX'), -50, 50, 1);
  private shadowY = makeNumber(t('panel.style.deco.shadowY'), -50, 50, 1);
  private shadowBlur = makeNumber(t('panel.style.deco.shadowBlur'), 0, 100, 1);
  private shadowSpread = makeNumber(t('panel.style.deco.shadowSpread'), -50, 50, 1);
  private shadowColor = makeColor(t('panel.style.deco.shadowColor'));
  private shadowToggle = document.createElement('input');
  /** 整个面板是否处于禁用态（无选中 / 能力守卫）。阴影子项的可用性 = 未禁用 且 开关已勾。 */
  private allDisabled = false;

  constructor(host: HTMLElement, commit: BoxCommit) {
    this.root = document.createElement('div');
    this.root.className = 'ep-deco';

    const title = document.createElement('h4');
    title.textContent = t('panel.style.deco');
    this.root.appendChild(title); // 外观由 app.css 的 .ep-deco > h4 承担

    hintField(this.borderWidth, 'border-width');
    hintField(this.borderStyle, 'border-style');
    hintField(this.borderColor, 'border-color');
    hintField(this.radius, 'border-radius');
    hintField(this.opacity, 'opacity');

    this.root.appendChild(this.borderWidth.el);
    this.root.appendChild(this.borderStyle.el);
    this.root.appendChild(this.borderColor.el);
    this.root.appendChild(this.radius.el);
    this.root.appendChild(this.opacity.el);

    // box-shadow 开关：勾选 = 启用阴影（T122 前是「无阴影」反向语义）
    const trow = document.createElement('div');
    trow.className = 'ep-field';
    this.shadowToggle.type = 'checkbox';
    const tlab = document.createElement('label');
    tlab.textContent = t('panel.style.deco.shadow');
    trow.appendChild(this.shadowToggle);
    trow.appendChild(tlab);
    this.root.appendChild(trow);
    for (const f of [this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread, this.shadowColor]) {
      this.root.appendChild(f.el);
    }
    hintField(this.shadowX, 'box-shadow x 偏移');
    hintField(this.shadowY, 'box-shadow y 偏移');
    hintField(this.shadowBlur, 'box-shadow 模糊半径');
    hintField(this.shadowSpread, 'box-shadow 扩散半径');
    hintField(this.shadowColor, 'box-shadow 颜色');

    // border：分别提交分量，互不覆盖
    this.borderWidth.onCommit((v) => commit('borderWidth', v === '' ? '' : `${v}px`));
    this.borderStyle.onCommit((v) => commit('borderStyle', v === 'none' ? '' : v));
    this.borderColor.onCommit((v) => commit('borderColor', v));
    this.radius.onCommit((v) => commit('borderRadius', v === '' ? '' : `${v}px`));
    this.opacity.onCommit((v) => commit('opacity', v === '' || parseFloat(v) === 1 ? '' : v));

    // shadow 任一输入变化 → 按当前五个输入重建
    const rebuild = () => {
      if (!this.shadowToggle.checked) return;
      commit('boxShadow', buildShadow({
        x: num(this.shadowX), y: num(this.shadowY), blur: num(this.shadowBlur),
        spread: num(this.shadowSpread), color: currentColor(this.shadowColor),
      }));
    };
    for (const f of [this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread]) {
      f.onCommit(() => rebuild());
    }
    this.shadowColor.onCommit(() => rebuild());

    this.shadowToggle.addEventListener('change', () => {
      // 首次启用且四向全 0 → 给一组可见的默认值，避免勾上后看不见任何变化
      if (this.shadowToggle.checked
        && num(this.shadowX) === 0 && num(this.shadowY) === 0
        && num(this.shadowBlur) === 0 && num(this.shadowSpread) === 0) {
        this.shadowY.setValue('2');
        this.shadowBlur.setValue('8');
      }
      this.syncShadowDisabled();
      if (this.shadowToggle.checked) rebuild();
      else commit('boxShadow', '');
    });

    host.appendChild(this.root);
  }

  /** 阴影子项可用性 = 未整体禁用 且 开关已勾选。 */
  private syncShadowDisabled(): void {
    const d = this.allDisabled || !this.shadowToggle.checked;
    for (const f of [this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread, this.shadowColor]) {
      f.setDisabled(d);
    }
  }

  refresh(cssList: (CSSStyleDeclaration | null)[]): void {
    const common = <T>(get: (c: CSSStyleDeclaration) => T): T | '' => {
      if (cssList.length === 0) return '';
      const first = cssList[0] ? get(cssList[0]!) : '';
      for (const c of cssList) {
        if (!c) return '';
        if (get(c) !== first) return '';
      }
      return first ?? '';
    };
    this.borderWidth.setValue(String(px(common((c) => c.borderTopWidth) as string)));
    this.borderStyle.setValue(common((c) => c.borderTopStyle) as string);
    this.borderColor.setValue(toHex(common((c) => c.borderTopColor) as string));
    this.radius.setValue(String(px(common((c) => c.borderTopLeftRadius) as string)));
    this.opacity.setValue((common((c) => c.opacity) as string) ?? '');
    const shStr = common((c) => c.boxShadow) as string;
    const sh = shStr && shStr !== 'none' ? parseShadow(shStr) : null;
    this.shadowToggle.checked = !!sh;
    this.shadowX.setValue(sh ? String(sh.x) : '0');
    this.shadowY.setValue(sh ? String(sh.y) : '0');
    this.shadowBlur.setValue(sh ? String(sh.blur) : '0');
    this.shadowSpread.setValue(sh ? String(sh.spread) : '0');
    this.shadowColor.setValue(sh ? toHex(sh.color) : '#000000');
    this.syncShadowDisabled();
  }

  /** 未选中态：清空全部显示值（颜色控件无法空值，改为 data-unset 视觉降级）。 */
  clear(): void {
    for (const f of [this.borderWidth, this.borderStyle, this.borderColor, this.radius,
      this.opacity, this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread, this.shadowColor]) {
      f.setValue('');
    }
    this.shadowToggle.checked = false;
    this.syncShadowDisabled();
  }

  setDisabled(d: boolean): void {
    this.allDisabled = d;
    for (const f of [this.borderWidth, this.borderStyle, this.borderColor, this.radius, this.opacity]) {
      f.setDisabled(d);
    }
    this.shadowToggle.disabled = d;
    this.syncShadowDisabled();
  }
}

function num(f: ReturnType<typeof makeNumber>): number {
  const v = (f.el.querySelector('input') as HTMLInputElement | null)?.value;
  return v ? parseFloat(v) || 0 : 0;
}
function currentColor(f: ReturnType<typeof makeColor>): string {
  return (f.el.querySelector('input') as HTMLInputElement | null)?.value || '#000000';
}
function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function toHex(rgb: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(rgb.trim());
  if (!m) return /^#/.test(rgb) ? rgb : '#000000';
  const parts = (m[1] as string).split(',').map((s) => parseInt(s.trim(), 10));
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(parts[0] ?? 0)}${to(parts[1] ?? 0)}${to(parts[2] ?? 0)}`;
}
