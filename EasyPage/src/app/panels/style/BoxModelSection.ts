// 盒模型区（T109）：width/height、margin/padding 四向。外壳节点，ep- 前缀。
import { inlineSizeValue } from '../../../core/style/boxProps';
import { makeNumber } from './fields';

export interface BoxCommit {
  (prop: string, cssValue: string): void;
}

export class BoxModelSection {
  readonly root: HTMLElement;
  private fields: { prop: string; f: ReturnType<typeof makeNumber> }[] = [];

  constructor(host: HTMLElement, commit: BoxCommit) {
    this.root = document.createElement('div');
    this.root.className = 'ep-box';

    const title = document.createElement('h4');
    title.textContent = '盒模型';
    title.style.cssText = 'margin:8px 0 4px;font-size:12px;';
    this.root.appendChild(title);

    const defs: Array<[string, string, number, number]> = [
      ['width', 'width', 0, 5000],
      ['height', 'height', 0, 5000],
      ['marginTop', 'margin-top', -200, 200],
      ['marginRight', 'margin-right', -200, 200],
      ['marginBottom', 'margin-bottom', -200, 200],
      ['marginLeft', 'margin-left', -200, 200],
      ['paddingTop', 'padding-top', 0, 200],
      ['paddingRight', 'padding-right', 0, 200],
      ['paddingBottom', 'padding-bottom', 0, 200],
      ['paddingLeft', 'padding-left', 0, 200],
    ];
    for (const [prop, label, min, max] of defs) {
      const f = makeNumber(label, min, max, 1);
      this.fields.push({ prop, f });
      f.onCommit((v) => commit(prop, v === '' ? '' : `${v}px`));
      this.root.appendChild(f.el);
    }
    host.appendChild(this.root);
  }

  refresh(els: Element[], cssList: (CSSStyleDeclaration | null)[]): void {
    const n = els.length;
    for (const { prop, f } of this.fields) {
      if (n === 0) { f.setValue(''); continue; }
      if (prop === 'width' || prop === 'height') {
        // 多选：每个元素都显式 inline px 且数值相同才回填，否则留空
        const vals = els.map((el) => inlineSizeValue((el as HTMLElement).style[prop]));
        const common = vals.every((v) => v !== '' && v === vals[0]);
        f.setValue(common ? vals[0]! : '');
        continue;
      }
      const vals = cssList.map((c) => (c ? String(parseNum(c[prop as keyof CSSStyleDeclaration] as string)) : ''));
      const common = vals.every((v) => v === vals[0] && v !== '');
      f.setValue(common ? vals[0]! : '');
    }
  }

  setDisabled(d: boolean): void {
    for (const { f } of this.fields) f.setDisabled(d);
  }
}

function parseNum(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
