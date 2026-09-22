// 外观区（T109）：border 三分量、radius、box-shadow 五输入+开关、opacity。外壳 ep- 节点。
import { buildShadow, parseShadow } from '../../../core/style/boxProps';
import { makeColor, makeNumber, makeSelect } from './fields';
import type { BoxCommit } from './BoxModelSection';

export class DecorationSection {
  readonly root: HTMLElement;
  private borderWidth = makeNumber('border-width', 0, 40, 1);
  private borderStyle = makeSelect('border-style', [
    { value: 'none', label: 'none' },
    { value: 'solid', label: 'solid' },
    { value: 'dashed', label: 'dashed' },
    { value: 'dotted', label: 'dotted' },
  ], '');
  private borderColor = makeColor('border-color');
  private radius = makeNumber('radius', 0, 100, 1);
  private opacity = makeNumber('opacity', 0, 1, 0.05);
  private shadowX = makeNumber('shadow-x', -50, 50, 1);
  private shadowY = makeNumber('shadow-y', -50, 50, 1);
  private shadowBlur = makeNumber('shadow-blur', 0, 100, 1);
  private shadowSpread = makeNumber('shadow-spread', -50, 50, 1);
  private shadowColor = makeColor('shadow-color');
  private shadowToggle = document.createElement('input');

  constructor(host: HTMLElement, commit: BoxCommit) {
    this.root = document.createElement('div');
    this.root.className = 'ep-deco';

    const title = document.createElement('h4');
    title.textContent = '外观';
    this.root.appendChild(title); // 外观由 app.css 的 .ep-deco > h4 承担

    this.root.appendChild(this.borderWidth.el);
    this.root.appendChild(this.borderStyle.el);
    this.root.appendChild(this.borderColor.el);
    this.root.appendChild(this.radius.el);
    this.root.appendChild(this.opacity.el);

    // box-shadow 开关
    const trow = document.createElement('div');
    trow.className = 'ep-field';
    this.shadowToggle.type = 'checkbox';
    const tlab = document.createElement('label');
    tlab.textContent = '无阴影';
    trow.appendChild(this.shadowToggle);
    trow.appendChild(tlab);
    this.root.appendChild(trow);
    for (const f of [this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread, this.shadowColor]) {
      this.root.appendChild(f.el);
    }

    // border：分别提交分量，互不覆盖
    this.borderWidth.onCommit((v) => commit('borderWidth', v === '' ? '' : `${v}px`));
    this.borderStyle.onCommit((v) => commit('borderStyle', v === 'none' ? '' : v));
    this.borderColor.onCommit((v) => commit('borderColor', v));
    this.radius.onCommit((v) => commit('borderRadius', v === '' ? '' : `${v}px`));
    this.opacity.onCommit((v) => commit('opacity', v === '' || parseFloat(v) === 1 ? '' : v));
    // shadow 任一输入变化 → 按当前五个输入重建；开关勾选（无阴影）→ 移除内联
    const rebuild = () => {
      const off = this.shadowToggle.checked;
      commit('boxShadow', off ? '' : buildShadow({
        x: num(this.shadowX), y: num(this.shadowY), blur: num(this.shadowBlur),
        spread: num(this.shadowSpread), color: currentColor(this.shadowColor),
      }));
    };
    for (const f of [this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread]) {
      f.onCommit(() => rebuild());
    }
    this.shadowColor.onCommit(() => rebuild());
    this.shadowToggle.addEventListener('change', () => rebuild());

    host.appendChild(this.root);
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
    this.shadowToggle.checked = !sh;
    this.shadowX.setValue(sh ? String(sh.x) : '0');
    this.shadowY.setValue(sh ? String(sh.y) : '0');
    this.shadowBlur.setValue(sh ? String(sh.blur) : '0');
    this.shadowSpread.setValue(sh ? String(sh.spread) : '0');
    this.shadowColor.setValue(sh ? toHex(sh.color) : '#000000');
  }

  setDisabled(d: boolean): void {
    for (const f of [this.borderWidth, this.borderStyle, this.borderColor, this.radius,
      this.opacity, this.shadowX, this.shadowY, this.shadowBlur, this.shadowSpread, this.shadowColor]) {
      f.setDisabled(d);
    }
    this.shadowToggle.disabled = d;
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
