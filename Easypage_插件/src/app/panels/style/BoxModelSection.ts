// 盒模型区（T109）：width/height、margin/padding 四向。外壳节点，ep- 前缀。
// T122：标签本地化，英文 CSS 属性名退到 label 的 title（hover 可见），不再与上方
//       文字属性区的中文标签混排。
import { t, type MessageKey } from '../../i18n/zh-CN';
import { inlineSizeValue } from '../../../core/style/boxProps';
import { hintField, makeNumber } from './fields';

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
    title.textContent = t('panel.style.box');
    this.root.appendChild(title); // 外观由 app.css 的 .ep-box > h4 承担

    // ⚠️ DOM 顺序 = e2e 的索引基线，**不可调整**。
    //    style-box.spec / multi-select-style.spec 用
    //    `panel.locator('.ep-box input[type=number]').nth(i)` 取字段：
    //      0=width 1=height 2..5=margin 上右下左 6..9=padding 上右下左
    //    批次 1 · R8 的「图形化」只做视觉重排（grid-area）与分组包裹，
    //    节点相对顺序逐字保持。
    // [JS 属性, CSS 属性名（label 的 title 提示）, 文案 key, min, max]
    const defs: Array<[string, string, MessageKey, number, number]> = [
      ['width', 'width', 'panel.style.box.width', 0, 5000],
      ['height', 'height', 'panel.style.box.height', 0, 5000],
      ['marginTop', 'margin-top', 'panel.style.box.t', -200, 200],
      ['marginRight', 'margin-right', 'panel.style.box.r', -200, 200],
      ['marginBottom', 'margin-bottom', 'panel.style.box.b', -200, 200],
      ['marginLeft', 'margin-left', 'panel.style.box.l', -200, 200],
      ['paddingTop', 'padding-top', 'panel.style.box.t', 0, 200],
      ['paddingRight', 'padding-right', 'panel.style.box.r', 0, 200],
      ['paddingBottom', 'padding-bottom', 'panel.style.box.b', 0, 200],
      ['paddingLeft', 'padding-left', 'panel.style.box.l', 0, 200],
    ];

    // 三个视觉容器：宽高并排 / 外边距同心框 / 内边距同心框
    const sizeRow = document.createElement('div');
    sizeRow.className = 'ep-box__size';
    const margin = makeBoxGroup(t('panel.style.box.margin'));
    const padding = makeBoxGroup(t('panel.style.box.padding'));
    this.root.append(sizeRow, margin.root, padding.root);

    for (const [prop, hint, key, min, max] of defs) {
      const f = makeNumber(t(key), min, max, 1);
      hintField(f, hint);
      this.fields.push({ prop, f });
      f.onCommit((v) => commit(prop, v === '' ? '' : `${v}px`));
      if (prop === 'width' || prop === 'height') sizeRow.appendChild(f.el);
      else if (prop.startsWith('margin')) margin.grid.appendChild(f.el);
      else padding.grid.appendChild(f.el);
    }
    host.appendChild(this.root);
  }

  /** 未选中态：清空全部显示值，避免残留上一个元素的值。 */
  clear(): void {
    for (const { f } of this.fields) f.setValue('');
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

/** 一组同心矩形（外边距 / 内边距）：标题 + 2×2 方位网格。 */
function makeBoxGroup(title: string): { root: HTMLDivElement; grid: HTMLDivElement } {
  const root = document.createElement('div');
  root.className = 'ep-box__group';
  const head = document.createElement('div');
  head.className = 'ep-box__group-title';
  head.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'ep-box__grid';
  root.append(head, grid);
  return { root, grid };
}
