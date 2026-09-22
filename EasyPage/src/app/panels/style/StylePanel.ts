// 右侧样式面板（T108）：随选中双向同步；文字属性改动走 SetStyleCommand，可撤销。
// 面板节点全在外壳 #ep-app 内、带 ep- 前缀，绝不注入被编辑文档。

import { t } from '../../i18n/zh-CN';
import type { EditorSession } from '../../../core/ports';
import { SetStyleCommand, SetAttributeCommand } from '../../../core/commands/commands';
import {
  FONT_FAMILY_CHOICES,
  FONT_WEIGHT_CHOICES,
  TEXT_ALIGN_CHOICES,
  commonValue,
  parseLineHeight,
  parsePx,
} from '../../../core/style/textProps';
import { makeColor, makeNumber, makeSelect, makeText, type FieldHandle } from './fields';
import { BoxModelSection } from './BoxModelSection';
import { DecorationSection } from './DecorationSection';

export interface StylePanelDeps {
  getSession: () => EditorSession | null;
}

export class StylePanel {
  private readonly root: HTMLElement;
  private readonly deps: StylePanelDeps;
  private fontFamily = makeSelect(t('panel.style.fontFamily'), FONT_FAMILY_CHOICES, t('panel.style.mixed'));
  private fontSize = makeNumber(t('panel.style.fontSize'), 8, 96, 1);
  private fontWeight = makeSelect(t('panel.style.fontWeight'), FONT_WEIGHT_CHOICES.map((v) => ({ value: v, label: v })), t('panel.style.mixed'));
  private color = makeColor(t('panel.style.color'));
  private bgColor = makeColor(t('panel.style.bgColor'));
  private align = makeSelect(t('panel.style.align'), TEXT_ALIGN_CHOICES, t('panel.style.mixed'));
  private lineHeight = makeNumber(t('panel.style.lineHeight'), 0.5, 4, 0.1);
  private letterSpacing = makeNumber(t('panel.style.letterSpacing'), -5, 20, 1);
  private linkUrl = makeText(t('panel.style.link'), 'https://…');
  private notice = document.createElement('div');
  private box!: BoxModelSection;
  private deco!: DecorationSection;

  constructor(host: HTMLElement, deps: StylePanelDeps) {
    this.deps = deps;
    this.root = document.createElement('aside');
    this.root.className = 'ep-panel';
    this.root.style.width = '220px';
    this.root.style.padding = '8px';
    this.root.style.borderLeft = '1px solid #ddd';
    this.root.style.boxSizing = 'border-box';

    const title = document.createElement('h3');
    title.textContent = t('panel.style.title');
    title.style.margin = '0 0 8px';
    this.root.appendChild(title);

    this.root.appendChild(this.fontFamily.el);
    this.root.appendChild(this.fontSize.el);
    this.root.appendChild(this.fontWeight.el);
    this.root.appendChild(this.color.el);
    this.root.appendChild(this.bgColor.el);
    this.root.appendChild(this.align.el);
    this.root.appendChild(this.lineHeight.el);
    this.root.appendChild(this.letterSpacing.el);

    this.notice.className = 'ep-notice';
    this.notice.style.cssText = 'font-size:12px;color:#c0392b;margin:4px 0;display:none;';
    this.root.appendChild(this.notice);
    this.root.appendChild(this.linkUrl.el);

    this.fontFamily.onCommit((v) => this.commitStyle('fontFamily', v));
    this.fontSize.onCommit((v) => this.commitStyle('fontSize', v ? `${v}px` : ''));
    this.fontWeight.onCommit((v) => this.commitStyle('fontWeight', v));
    this.color.onCommit((v) => this.commitStyle('color', v));
    this.bgColor.onCommit((v) => this.commitStyle('backgroundColor', v));
    this.align.onCommit((v) => this.commitStyle('textAlign', v));
    this.lineHeight.onCommit((v) => this.commitStyle('lineHeight', v || 'normal'));
    this.letterSpacing.onCommit((v) => this.commitStyle('letterSpacing', v ? `${v}px` : 'normal'));
    this.linkUrl.onCommit((v) => this.commitHref(v));

    this.box = new BoxModelSection(this.root, (prop, v) => this.commitStyle(prop, v));
    this.deco = new DecorationSection(this.root, (prop, v) => this.commitStyle(prop, v));
    host.appendChild(this.root);
  }

  /** 选中变化时刷新面板。 */
  refresh(): void {
    const session = this.deps.getSession();
    const els = [...(session?.selection.elements ?? [])];
    if (!session || els.length === 0) {
      this.setAllDisabled(true);
      this.linkUrl.setDisabled(true);
      this.showNotice('');
      return;
    }
    // 能力守卫：任一非 full 即禁用整组并提示，不回填。
    const nonFull = els.find((el) => session.capabilities.of(el) !== 'full');
    if (nonFull) {
      this.setAllDisabled(true);
      this.linkUrl.setDisabled(true);
      this.showNotice(t(session.capabilities.reasonOf(nonFull) as Parameters<typeof t>[0]));
      return;
    }
    this.showNotice('');
    this.setAllDisabled(false);

    const css = els.map((el) => (el.ownerDocument.defaultView ?? window).getComputedStyle(el));
    this.fontFamily.setValue(commonValue(css.map((c) => c.fontFamily)) ?? '');
    // 数值三项：归一为控件字符串后 commonValue，无共有值留空（混合）。
    this.fontSize.setValue(commonValue(css.map((c) => String(Math.round(parsePx(c.fontSize ?? '0px') ?? 0)))) ?? '');
    this.fontWeight.setValue(commonValue(css.map((c) => c.fontWeight)) ?? '');
    this.lineHeight.setValue(commonValue(css.map((c) => String(parseLineHeight(c.lineHeight ?? 'normal') ?? ''))) ?? '');
    this.letterSpacing.setValue(commonValue(css.map((c) => String(parsePx(c.letterSpacing ?? '0px') ?? 0))) ?? '');
    // 颜色两项：原始 rgb() 字符串 commonValue，共有才 toHex；无共有值清空，绝不显示首个颜色冒充。
    const colorStr = commonValue(css.map((c) => c.color));
    this.color.setValue(colorStr ? toHex(colorStr) : '');
    const bgStr = commonValue(css.map((c) => c.backgroundColor));
    this.bgColor.setValue(bgStr ? toHex(bgStr) : '');
    this.align.setValue(commonValue(css.map((c) => c.textAlign)) ?? '');

    // 链接：仅单选且为 <a> 启用并回填 href，否则禁用清空。
    if (els.length === 1 && (els[0] as Element).tagName === 'A') {
      this.linkUrl.setDisabled(false);
      this.linkUrl.setValue((els[0] as Element).getAttribute('href') ?? '');
    } else {
      this.linkUrl.setDisabled(true);
      this.linkUrl.setValue('');
    }

    // 盒模型/外观：多选时取共有值，不一致留空。
    this.box.refresh(els, css);
    this.deco.refresh(css);
  }

  /** 链接 href：value 非空设置，空移除。走 SetAttributeCommand，无变化不入栈。 */
  private commitHref(value: string): void {
    const session = this.deps.getSession();
    const els = [...(session?.selection.elements ?? [])];
    if (!session || els.length !== 1 || (els[0] as Element).tagName !== 'A') return;
    const el = els[0] as Element;
    const prev = el.getAttribute('href');
    const next = value.trim() === '' ? null : value.trim();
    if ((prev ?? null) === next) return;
    session.history.push(new SetAttributeCommand(el, 'href', next, prev));
    session.markDirty();
  }

  private showNotice(msg: string): void {
    if (msg) {
      this.notice.style.display = '';
      this.notice.textContent = msg;
    } else {
      this.notice.style.display = 'none';
      this.notice.textContent = '';
    }
  }

  /** 提交规约：快照初始内联 → 写内联预览 → diff → 一条 SetStyleCommand，无变化不入栈。 */
  private commitStyle(prop: string, cssValue: string): void {
    const session = this.deps.getSession();
    const els = [...(session?.selection.elements ?? [])];
    if (!session || els.length === 0) return;
    const prev = new Map<Element, Record<string, string>>();
    let anyChanged = false;
    for (const el of els) {
      const before = (el as HTMLElement).style[prop as never] as string;
      prev.set(el, { [prop]: before || '' });
    }
    for (const el of els) {
      (el as HTMLElement).style[prop as never] = cssValue;
      const after = (el as HTMLElement).style[prop as never] as string;
      if (prev.get(el)![prop] !== after) anyChanged = true;
    }
    if (!anyChanged) return;
    session.history.push(new SetStyleCommand(els, { [prop]: cssValue }, prev));
    session.markDirty();
  }

  private setAllDisabled(d: boolean): void {
    const fields: FieldHandle[] = [
      this.fontFamily, this.fontSize, this.fontWeight, this.color,
      this.bgColor, this.align, this.lineHeight, this.letterSpacing,
    ];
    for (const f of fields) f.setDisabled(d);
    this.box.setDisabled(d);
    this.deco.setDisabled(d);
  }
}

function toHex(rgb: string): string {
  const m = /rgba?\(([^)]+)\)/.exec(rgb.trim());
  if (!m) return '#000000';
  const parts = (m[1] as string).split(',').map((s) => parseInt(s.trim(), 10));
  const to = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to(parts[0] ?? 0)}${to(parts[1] ?? 0)}${to(parts[2] ?? 0)}`;
}
