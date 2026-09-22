// 应用外壳（契约 01 §3 app/）：顶部三按钮 + 粘贴 textarea + 文件 input + toast。
// 边界 try/catch，异常 toast 走 i18n key，不白屏。本卡用原生 DOM，不引框架。

import { t } from './i18n/zh-CN';
import { saveDraft, loadDraft, clearDraft } from '../core/stores/draft';
import type { EditorSession, HtmlIO, SessionMeta } from '../core/ports';
import { EditorError } from '../core/EditorError';
import { EditorSessionModel } from '../core/model/EditorSession';
import { SetTextCommand, ResizeCommand } from '../core/commands/commands';
import { InlineWrapCommand } from '../core/commands/inlineCommands';
import { checkSelection, findEnclosingWrap } from '../core/inline/wrapInline';
import { INTERACTION } from '../constants';
import { isResizable } from '../core/interaction/resizeGuard';
import { clearTranslate } from '../core/interaction/transform';
import { computeResize, type ResizeDirection } from '../core/interaction/resize';
import { sanitizeImport } from '../core/io/sanitizeImport';
import { auditResources } from '../core/serialize/resourceAudit';
import { frameToOverlay, rectOf, rectsIntersect } from './canvas/geom';
import { DomParserIO } from '../adapters/dom/DomParserIO';
import { IFramePreviewSandbox } from '../adapters/preview/IFramePreviewSandbox';
import { SelfInteractionAdapter } from '../adapters/interaction/SelfInteractionAdapter';
import { CanvasHost } from './canvas/CanvasHost';
import { InlineTextEditor } from './canvas/InlineTextEditor';
import { OverlayLayer } from './canvas/OverlayLayer';
import { StylePanel } from './panels/style/StylePanel';
import { FormatPainter } from './ribbon/FormatPainter';
import { ElementsPanel } from './panels/elements/ElementsPanel';
import { ImagePicker } from './panels/elements/ImagePicker';
import { create as createNode, createImage, insertionPoint, type ElementKind } from '../core/elements/factory';
import { InsertNodeCommand, RemoveNodeCommand, WrapListCommand, UnwrapListCommand, BatchCommand, MoveCommand } from '../core/commands/commands';
import { canUnwrapList, canWrapList } from '../core/elements/list';
import { duplicateNode } from '../core/elements/duplicate';
import { ContextMenu } from './ContextMenu';
import { matchAction, normalize, classifyTarget, resolveGuard } from './keymap';
import { LockState } from '../core/model/LockState';
import { ReorderNodeCommand, SetDisplayCommand, SetStyleCommand } from '../core/commands/commands';
import { LayersPanel } from './panels/layers/LayersPanel';
import { Marquee } from './canvas/Marquee';
import { compute, type AlignType } from '../core/layout/alignment';
import { Breadcrumb } from './statusbar/Breadcrumb';
import { LinkPopover } from './panels/ribbon/LinkPopover';

export class App {
  private readonly root: HTMLElement;
  private readonly io: HtmlIO;
  private canvas!: CanvasHost;
  private preview!: IFramePreviewSandbox;
  private overlay!: OverlayLayer;
  private breadcrumb!: Breadcrumb;
  private inlineEditor!: InlineTextEditor;
  private session!: EditorSession;
  private interaction!: SelfInteractionAdapter;
  private stylePanel!: StylePanel;
  private formatPainter!: FormatPainter;
  private elementsPanel!: ElementsPanel;
  private imagePicker!: ImagePicker;
  private layersPanel!: LayersPanel;
  private marquee!: Marquee;
  private lock = new LockState();
  private menu!: ContextMenu;
  private linkPopover!: LinkPopover;
  private previewOpen = false;

  private textarea!: HTMLTextAreaElement;
  private fileInput!: HTMLInputElement;
  private draftRow!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private canvasHostEl!: HTMLDivElement;
  private previewHostEl!: HTMLDivElement;
  private statusbarEl!: HTMLDivElement;

  constructor(root: HTMLElement, deps: { io: HtmlIO }) {
    this.root = root;
    this.io = deps.io;
  }

  mount(): void {
    this.root.textContent = '';
    this.root.style.display = 'flex';
    this.root.style.flexDirection = 'column';
    this.root.style.gap = '8px';
    this.root.style.padding = '8px';

    const title = document.createElement('h1');
    title.textContent = t('app.title');
    title.style.margin = '0';
    this.root.appendChild(title);

    // 工具栏
    const toolbar = document.createElement('div');
    toolbar.style.display = 'flex';
    toolbar.style.gap = '8px';

    const importBtn = this.makeButton(t('button.import'), () => this.importFromTextarea());
    const blankBtn = this.makeButton(t('button.blank'), () => this.loadBlank());
    const previewBtn = this.makeButton(t('button.preview'), () => this.togglePreview());
    const exportBtn = this.makeButton(t('button.export'), () => this.exportHtml());
    const copyBtn = this.makeButton(t('button.copyHtml'), () => this.copyHtml());
    const resetBtn = this.makeButton(t('button.resetTransform'), () => this.resetTransform());
    const painterBtn = this.makeButton(t('button.formatPainter'), () => this.formatPainter.startOnce());
    painterBtn.addEventListener('dblclick', () => this.formatPainter.startContinuous());
    toolbar.append(importBtn, blankBtn, previewBtn, exportBtn, copyBtn, resetBtn, painterBtn);
    this.root.appendChild(toolbar);

    // 对齐/分布按钮组（T113）
    const alignRow = document.createElement('div');
    alignRow.style.display = 'flex';
    alignRow.style.gap = '4px';
    const mkAlign = (label: string, type: AlignType) => {
      const b = this.makeButton(label, () => this.doAlign(type));
      b.dataset.align = type;
      return b;
    };
    alignRow.append(
      mkAlign(t('align.left'), 'left'), mkAlign(t('align.right'), 'right'), mkAlign(t('align.hcenter'), 'hcenter'),
      mkAlign(t('align.top'), 'top'), mkAlign(t('align.bottom'), 'bottom'), mkAlign(t('align.vcenter'), 'vcenter'),
      mkAlign(t('align.hdistribute'), 'hdistribute'), mkAlign(t('align.vdistribute'), 'vdistribute'),
    );
    this.root.appendChild(alignRow);

    // 粘贴 + 文件
    const pasteRow = document.createElement('div');
    pasteRow.style.display = 'flex';
    pasteRow.style.gap = '8px';

    this.textarea = document.createElement('textarea');
    this.textarea.placeholder = t('placeholder.pasteHtml');
    this.textarea.style.flex = '1';
    this.textarea.style.minHeight = '80px';
    pasteRow.appendChild(this.textarea);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.html,text/html';
    this.fileInput.addEventListener('change', () => this.importFromFile());
    pasteRow.appendChild(this.fileInput);
    this.root.appendChild(pasteRow);

    // 草稿区（T117）：有草稿时渲染「继续 / 删除」，无草稿只留占位。
    // 注意：这一段曾在重构中丢失（draftRow 只声明未挂载），导致 Ctrl+S 存下的草稿
    // 在重新打开后没有任何恢复入口 —— 这是「草稿续开」失效的根因。
    this.draftRow = document.createElement('div');
    this.draftRow.id = 'ep-draft-row';
    this.draftRow.className = 'ep__draft-row';
    this.draftRow.style.display = 'flex';
    this.draftRow.style.gap = '8px';
    this.draftRow.style.alignItems = 'center';
    this.root.appendChild(this.draftRow);
    this.refreshDraftList();

    // 左元素面板 +（编辑 iframe + overlay）+ 右侧样式面板
    const outerRow = document.createElement('div');
    outerRow.style.display = 'flex';
    outerRow.style.alignItems = 'flex-start';
    this.root.appendChild(outerRow);
    this.elementsPanel = new ElementsPanel(outerRow);
    this.elementsPanel.onInsert((kind) => this.insertElement(kind));
    this.elementsPanel.onDelete(() => this.deleteSelected());
    this.elementsPanel.onList((tag) => this.toggleList(tag));
    this.layersPanel = new LayersPanel(outerRow);
    this.layersPanel.setHooks({
      select: (el) => this.selectFromLayers(el),
      toggleLock: (el) => this.toggleLock(el),
      toggleHide: (el) => this.toggleHide(el),
      reorder: (el, dir) => this.reorderNode(el, dir),
    });
    this.layersPanel.bindRerender(() => this.refreshLayers());
    this.imagePicker = new ImagePicker();

    const mainRow = document.createElement('div');
    mainRow.style.display = 'flex';
    mainRow.style.alignItems = 'flex-start';
    outerRow.appendChild(mainRow);
    this.canvasHostEl = document.createElement('div');
    mainRow.appendChild(this.canvasHostEl);
    this.canvas = new CanvasHost(this.canvasHostEl);
    this.overlay = new OverlayLayer(this.canvas.overlay);
    this.overlay.onHandleStart((dir, e) => this.beginResize(dir, e));
    this.stylePanel = new StylePanel(mainRow, { getSession: () => this.session });
    this.formatPainter = new FormatPainter({
      getSession: () => this.session,
      notify: (k) => this.toast(k as Parameters<typeof t>[0]),
      setCursor: (c) => { this.canvasHostEl.style.cursor = c; },
    });
    this.inlineEditor = new InlineTextEditor((el, next, prev) =>
      this.commitTextEdit(el, next, prev),
    );
    this.canvas.onDblClick((el) => {
      if (this.lock.isLocked(el)) { this.toast('toast.locked'); return; }
      this.inlineEditor.start(el);
      this.clearSelection();
    });
    this.canvas.onHover((el) => this.layoutHover(el));
    this.canvas.onSelect((el: Element, shift: boolean) => this.onCanvasSelect(el, shift));
    this.canvas.onBlankDown((e: PointerEvent) => this.onBlankDown(e));
    this.marquee = new Marquee(this.canvas.overlay);

    this.menu = new ContextMenu(this.root);
    this.linkPopover = new LinkPopover(this.root);
    this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showMenu(e.clientX, e.clientY); });
    // 拖拽微移适配器：只在 committed 时 push 一个 MoveCommand
    this.interaction = new SelfInteractionAdapter(this.canvas.overlay, this.canvas.frame);
    this.interaction.isLocked = (el) => this.lock.isLocked(el);
    this.interaction.onDragMove(({ dx, dy, committed }) => {
      // 端口语义（ports.ts DragMoveEvent）：committed=true 才代表「一次拖拽的提交」。
      // 漏判会让每次 pointermove 都入栈，撤销一步只退一帧位移。
      if (!committed) return;
      const session = this.session;
      const sel = session?.selection.elements[0];
      if (!session || !sel) return;
      session.history.push(new MoveCommand([sel], dx, dy));
      session.markDirty();
    });

    // 全局快捷键：Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 或 Ctrl+Y 重做
    window.addEventListener('keydown', (e) => this.onGlobalKeydown(e));

    // 预览区
    this.previewHostEl = document.createElement('div');
    this.root.appendChild(this.previewHostEl);
    this.preview = new IFramePreviewSandbox(this.previewHostEl);

    // 面包屑状态栏
    this.statusbarEl = document.createElement('div');
    this.statusbarEl.id = 'ep-breadcrumb';
    this.root.appendChild(this.statusbarEl);
    this.breadcrumb = new Breadcrumb(this.statusbarEl);
    this.breadcrumb.onPick((el) => { this.session?.selection.select([el]); });

    // toast
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'ep-toast';
    this.root.appendChild(this.toastEl);
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', () => {
      try {
        onClick();
      } catch (err) {
        this.handleError(err);
      }
    });
    return btn;
  }

  // ── 导入 ──────────────────────────────────────────────────
  private importFromTextarea(): void {
    const source = this.textarea.value;
    void this.importSource(source, 'paste').catch((err) => this.handleError(err));
  }

  private importFromFile(): void {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const source = typeof reader.result === 'string' ? reader.result : '';
        void this.importSource(source, 'upload', file.name).catch((err) =>
          this.handleError(err),
        );
      } catch (err) {
        this.handleError(err);
      }
    };
    reader.onerror = () => {
      this.toast('toast.importFailed');
    };
    reader.readAsText(file);
  }

  private async importSource(
    source: string,
    kind: SessionMeta['sourceKind'],
    fileName = 'edited.html',
  ): Promise<void> {
    if (!source.trim()) {
      this.toast('toast.importEmpty');
      return;
    }
    // 导入净化（T119）：剥掉导出后会生效的危险标记（on* / javascript: / srcdoc / meta refresh 等）。
    // <script> 按契约保留——它在编辑帧不执行（sandbox 无 allow-scripts），预览帧另起同源隔离的沙箱。
    const clean = sanitizeImport(source);
    const parsed = this.io.parse(clean);
    // 净化后的 HTML 经 srcdoc 写入编辑 iframe，并以其 contentDocument 为事实源
    const doc = await this.canvas.loadHtml(clean);
    const meta: SessionMeta = {
      sourceKind: kind,
      fileName,
      originalSource: clean,
      warnings: parsed.warnings,
      externalResources: parsed.externalResources,
      dirty: false,
    };
    this.session = new EditorSessionModel(doc, meta);
    // 导入新文档清空历史
    doc.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showMenu(e.clientX, e.clientY); });
    doc.addEventListener('keydown', (e) => this.onGlobalKeydown(e));
    this.session.history.clear();
    // 选中变化时重定位覆盖层与面包屑
    this.session.selection.onChange(() => {
      this.layoutOverlay();
      const els = this.session?.selection.elements ?? [];
      if (els.length === 1 && els[0]) { this.refreshListButtons(els[0]); this.refreshLayers(); }
      else { this.elementsPanel.setListButtons(false, false, ''); this.refreshLayers(); }
    });
    this.overlay.setSelected(null);
    this.breadcrumb.render(null);
    this.refreshLayers();
    this.toast('toast.importOk');
  }

  // ── 就地改字提交（T102：入历史）────────────────────────────
  private commitTextEdit(el: Element, next: string, prev: string): void {
    if (!this.session) return;
    this.session.history.push(new SetTextCommand(el, next, prev));
    this.session.markDirty();
  }

  // ── 插入 / 删除（T111）─────────────────────────────────
  private async insertElement(kind: ElementKind): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (kind === 'img') {
      const choice = await this.imagePicker.choose();
      if (!choice) return; // 取消/空 → 不插入、不入历史
      const node = createImage(session.doc, choice.src, choice.isPlaceholder);
      const sel = session.selection.elements[0] ?? null;
      const { parent, index } = insertionPoint(session.doc, sel);
      session.history.push(new InsertNodeCommand(node, parent, index));
      session.markDirty();
      session.selection.select([node as Element]);
      return;
    }
    const node = createNode(session.doc, kind);
    const sel = session.selection.elements[0] ?? null;
    const { parent, index } = insertionPoint(session.doc, sel);
    session.history.push(new InsertNodeCommand(node, parent, index));
    session.markDirty();
    if (node.nodeType === 1) session.selection.select([node as Element]);
  }

  private deleteSelected(): void {
    const session = this.session;
    const sel = session?.selection.elements[0];
    if (!session || !sel) return;
    if (this.lock.isLocked(sel)) { this.toast('toast.locked'); return; }
    session.history.push(new RemoveNodeCommand(sel));
    session.markDirty();
    session.selection.clear();
  }

  private duplicateSelected(): void {
    const session = this.session;
    const sel = session?.selection.elements[0];
    if (!session || !sel) return;
    if (this.lock.isLocked(sel)) { this.toast('toast.locked'); return; }
    const parent = sel.parentElement;
    if (!parent) return;
    const idx = Array.from(parent.children).indexOf(sel) + 1;
    const clone = duplicateNode(session.doc, sel);
    session.history.push(new InsertNodeCommand(clone, parent, idx));
    session.markDirty();
    session.selection.select([clone]);
  }
  private showMenu(x: number, y: number): void {
    const session = this.session;
    if (!session) return;
    const els = session.selection.elements;
    const single = els.length === 1 ? els[0]! : null;
    const locked = single ? this.lock.isLocked(single) : false;
    const items = [
      { id: 'delete', label: t('menu.delete'), enabled: els.length > 0 && !locked },
      { id: 'duplicate', label: t('menu.duplicate'), enabled: !!single && !locked },
      { id: 'reset', label: t('menu.reset'), enabled: !!single && !locked },
      { id: 'toggleLock', label: locked ? t('menu.unlock') : t('menu.lock'), enabled: !!single },
    ];
    this.menu.show(x, y, items, { onPick: (id) => {
      if (id === 'delete') this.deleteSelected();
      else if (id === 'duplicate') this.duplicateSelected();
      else if (id === 'reset') { this.resetTransform(); }
      else if (id === 'toggleLock' && single) this.toggleLock(single);
    } });
  }

  private applyTextStyle(action: 'bold' | 'italic' | 'underline'): void {
    const session = this.session;
    if (!session) return;
    // 编辑态（contenteditable）走 execCommand 最小实现；非编辑态整元素 SetStyleCommand
    const sel = session.selection.elements[0];
    if (!sel) return;
    const propName = action === 'bold' ? 'fontWeight' : action === 'italic' ? 'fontStyle' : 'textDecoration';
    const cur = (sel as HTMLElement).style.getPropertyValue(propName);
    const next = action === 'bold' ? (cur === '700' ? '400' : '700')
      : action === 'italic' ? (cur === 'italic' ? 'normal' : 'italic')
      : (cur === 'underline' ? 'none' : 'underline');
    const props: Record<string,string> = {}; props[propName] = next;
    const prevMap = new Map<Element, Record<string,string>>();
    for (const el of session.selection.elements) { const p: Record<string,string> = {}; p[propName] = (el as HTMLElement).style.getPropertyValue(propName) || ''; prevMap.set(el, p); }
    session.history.push(new SetStyleCommand(session.selection.elements, props, prevMap));
    session.markDirty();
  }

  private applyInlineWrap(action: 'bold' | 'italic' | 'underline'): void {
    const session = this.session; if (!session) return;
    const sel = this.inlineEditingEl; if (!sel) { this.toast('toast.unsupported'); return; }
    const doc = sel.ownerDocument; const s = doc.getSelection(); if (!s || s.rangeCount === 0) { this.toast('toast.unsupported'); return; }
    const range = s.getRangeAt(0); const chk = checkSelection(range);
    if (!chk.ok) { this.toast('toast.unsupported'); return; }
    const tag = action === 'bold' ? 'strong' : action === 'italic' ? 'em' : 'u';
    const existing = findEnclosingWrap(range, tag);
    if (existing) { session.history.push(InlineWrapCommand.unwrap(existing)); session.markDirty(); return; }
    session.history.push(InlineWrapCommand.wrap(range.startContainer as Text, range.startOffset, range.endOffset, tag));
    session.markDirty();
  }

  private async applyInlineLink(): Promise<void> {
    const session = this.session; if (!session) return;
    const sel = this.inlineEditingEl; if (!sel) { this.toast('toast.unsupported'); return; }
    const doc = sel.ownerDocument; const s = doc.getSelection(); if (!s || s.rangeCount === 0) { this.toast('toast.unsupported'); return; }
    const range = s.getRangeAt(0).cloneRange(); const chk = checkSelection(range);
    if (!chk.ok) { this.toast('toast.unsupported'); return; }
    const r = await this.linkPopover.open();
    if (!r) return;
    if (!range.startContainer.isConnected) { this.toast('toast.unsupported'); return; }
    session.history.push(InlineWrapCommand.wrap(range.startContainer as Text, range.startOffset, range.endOffset, 'a', r.url));
    session.markDirty();
  }
  private get inlineEditingEl(): Element | null { return this.inlineEditor.getEditingEl(); }

  private toggleList(tag: 'ul' | 'ol'): void {
    const session = this.session;
    if (!session) return;
    const sel = session.selection.elements[0];
    if (!sel || session.selection.elements.length > 1) { this.toast('toast.listMulti'); return; }
    if (session.capabilities.of(sel) !== 'full') { this.toast('toast.blockOnly'); return; }
    if (canUnwrapList(sel)) {
      session.history.push(new UnwrapListCommand(sel));
      session.markDirty();
      const firstP = sel.parentElement?.querySelector('p');
      if (firstP) session.selection.select([firstP]);
      return;
    }
    if (canWrapList(sel)) {
      session.history.push(new WrapListCommand(sel, tag));
      session.markDirty();
      const listEl = session.doc.querySelector(tag);
      if (listEl) { session.selection.select([listEl]); this.refreshListButtons(listEl); }
      return;
    }
    this.toast('toast.listUnsupported');
  }

  private refreshListButtons(el: Element): void {
    if (canUnwrapList(el)) {
      this.elementsPanel.setListButtons(true, true, el.tagName.toLowerCase() as 'ul' | 'ol');
    } else if (canWrapList(el)) {
      this.elementsPanel.setListButtons(true, true, '');
    } else {
      this.elementsPanel.setListButtons(false, false, '');
    }
  }

  // ── 图层面板（T112）─────────────────────────────────────
  private selectFromLayers(el: Element): void {
    if (!this.session) return;
    this.session.selection.select([el]);
    el.scrollIntoView({ block: 'nearest' });
    this.refreshLayers();
  }
  private toggleLock(el: Element): void {
    this.lock.toggle(el);
    this.refreshLayers();
    this.layoutOverlay();
  }
  private toggleHide(el: Element): void {
    const session = this.session;
    if (!session) return;
    const cur = (el as HTMLElement).style.display;
    const next = cur === 'none' ? '' : 'none';
    const prev = cur;
    session.history.push(new SetDisplayCommand(el, next, prev));
    session.markDirty();
    this.refreshLayers();
  }
  private reorderNode(el: Element, dir: -1 | 1 | 'top' | 'bottom'): void {
    const session = this.session;
    const parent = el.parentElement;
    if (!session || !parent) return;
    const children = Array.from(parent.children);
    const from = children.indexOf(el);
    let to = from;
    if (dir === -1) to = from - 1;
    else if (dir === 1) to = from + 1;
    else if (dir === 'top') to = 0;
    else to = children.length - 1;
    if (to < 0 || to >= children.length || to === from) return;
    session.history.push(new ReorderNodeCommand(el, parent, from, to));
    session.markDirty();
    this.refreshLayers();
  }
  private refreshLayers(): void {
    if (!this.session) return;
    this.layersPanel.setSelected(this.session.selection.elements[0] ?? null);
    this.layersPanel.render(this.session.doc, this.lock);
  }
  // ── 覆盖层 / 选中 / 面包屑（T103）─────────────────────────
  private onCanvasSelect(el: Element, shift: boolean): void {
    if (this.formatPainter.isActive()) {
      this.formatPainter.paint(el);
      return;
    }
    if (!this.session) return;
    if (shift) {
      this.session.selection.toggle(el);
    } else {
      this.session.selection.select([el]);
    }
  }

  private onBlankDown(e: PointerEvent): void {
    const session = this.session;
    if (!session) return;
    this.clearSelection();
    const frameRect = this.canvas.frame.getBoundingClientRect();
    const origin = this.canvas.overlay.getBoundingClientRect();
    const sx = e.clientX - frameRect.left - origin.left;
    const sy = e.clientY - frameRect.top - origin.top;
    this.marquee.begin(sx, sy, (rect) => {
      const doc = session.doc;
      const docRect = this.canvas.frame.getBoundingClientRect();
      const overlayRect = this.canvas.overlay.getBoundingClientRect();
      const ox = overlayRect.left - docRect.left;
      const oy = overlayRect.top - docRect.top;
      const mLeft = rect.left - overlayRect.left;
      const mTop = rect.top - overlayRect.top;
      const mRight = mLeft + rect.width;
      const mBottom = mTop + rect.height;
      const hits: Element[] = [];
      for (const child of Array.from(doc.body.children)) {
        if (child.nodeType !== 1) continue;
        const r = child.getBoundingClientRect();
        const cl = r.left - docRect.left - ox;
        const ct = r.top - docRect.top - oy;
        if (rectsIntersect(
          { left: mLeft, top: mTop, right: mRight, bottom: mBottom },
          { left: cl, top: ct, right: cl + r.width, bottom: ct + r.height },
        )) {
          hits.push(child);
        }
      }
      if (hits.length > 0) session.selection.select(hits);
    });
    const move = (ev: PointerEvent) => {
      const mx = ev.clientX - frameRect.left - origin.left;
      const my = ev.clientY - frameRect.top - origin.top;
      this.marquee.move(mx, my);
    };
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      this.marquee.end();
    };
    const doc = this.canvas.contentDocument!;
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  private clearSelection(): void {
    if (!this.session) return;
    this.session.selection.clear();
  }

  private doAlign(type: AlignType): void {
    const session = this.session;
    const els = session?.selection.elements ?? [];
    if (!session) return;
    if (type === 'hdistribute' || type === 'vdistribute') {
      if (els.length < 3) { this.toast('toast.alignNeed3'); return; }
    } else if (els.length < 2) { this.toast('toast.alignNeed2'); return; }
    // 同父检查
    const parent = els[0]!.parentElement;
    if (!parent || els.some((el) => el.parentElement !== parent)) {
      this.toast('toast.alignCrossParent'); return;
    }
    if (els.some((el) => this.lock.isLocked(el))) { this.toast('toast.locked'); return; }
    const rects = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const deltas = compute(rects, type);
    const cmds = els.map((el, i) => new MoveCommand([el], deltas[i]!.dx, deltas[i]!.dy));
    session.history.push(new BatchCommand('align', cmds));
    session.markDirty();
    this.layoutOverlay();
  }

  private toOverlayBox(el: Element) {
    return frameToOverlay(
      rectOf(el),
      this.canvas.frame.getBoundingClientRect(),
      { x: 0, y: 0 },
    );
  }

  private layoutHover(el: Element): void {
    if (this.previewOpen) return;
    this.overlay.setHover(this.toOverlayBox(el));
  }

  /** 重定位选中框；元素已被删除则清空失效选中；同步拖拽适配器 attach/detach。 */
  private layoutOverlay(): void {
    if (!this.session || this.previewOpen) return;
    const selected = this.session.selection.elements;
    if (selected.length === 0 || !selected[0]?.isConnected) {
      if (selected[0]) this.session.selection.clear();
      this.overlay.setSelected(null);
      this.overlay.setSelectedMany([]);
      this.overlay.setLocked(false);
      this.breadcrumb.render(null);
      this.stylePanel.refresh();
      this.interaction.detach();
      return;
    }
    const boxes = selected.map((el) => this.toOverlayBox(el));
    this.overlay.setSelected(boxes[0]!);
    this.overlay.setSelectedMany(boxes);
    this.overlay.setHandlesVisible(selected.length === 1 && isResizable(selected[0]!).ok);
    this.overlay.setLocked(this.lock.isLocked(selected[0]!));
    this.breadcrumb.render(selected[0]!);
    this.stylePanel.refresh();
    this.interaction.attach(selected);
  }

  /** 重置位移：清除选中元素的 translate，回文档流。 */
  private resetTransform(): void {
    const session = this.session;
    const sel = session?.selection.elements[0];
    if (!session || !sel) return;
    clearTranslate(sel);
    session.markDirty();
    this.layoutOverlay();
  }

  /** 8 向缩放手势：临时写 width/height，pointerup push 一个 ResizeCommand（T106）。 */
  private beginResize(dir: ResizeDirection, e: PointerEvent): void {
    const session = this.session;
    const el = session?.selection.elements[0];
    if (!session || !el) return;
    if (this.lock.isLocked(el)) return;
    if (!isResizable(el).ok) return;
    const startRect = rectOf(el);
    const startSize = { width: startRect.width, height: startRect.height };
    // prev 记录操作前的原始 inline 字符串，null 表示原本无该声明
    const prevBox = {
      width: (el as HTMLElement).style.width || null,
      height: (el as HTMLElement).style.height || null,
    };
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const box = computeResize(dir, startSize, dx, dy, ev.shiftKey);
      (el as HTMLElement).style.width = `${box.width}px`;
      (el as HTMLElement).style.height = `${box.height}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const cur = rectOf(el);
      const w = Math.round(cur.width);
      const h = Math.round(cur.height);
      // 尺寸没变（单击手柄未拖动，或拖出去又拖回原点）⇒ 回滚临时内联样式，且不入历史。
      // 否则 width:auto 的元素会被固化成等值 px，还白占一步撤销。
      if (w === Math.round(startSize.width) && h === Math.round(startSize.height)) {
        (el as HTMLElement).style.width = prevBox.width ?? '';
        (el as HTMLElement).style.height = prevBox.height ?? '';
        this.layoutOverlay();
        return;
      }
      session.history.push(new ResizeCommand([el], { width: w, height: h }, prevBox));
      session.markDirty();
      this.layoutOverlay();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── 全局快捷键：撤销 / 重做 ────────────────────────────────
  private onGlobalKeydown(e: KeyboardEvent): void {
    if (!this.session) return;
    const c = normalize(e);
    const action = matchAction(c);
    const kind = classifyTarget(e.target);
    const guard = resolveGuard(action, kind);
    if (guard.prevent) e.preventDefault();
    if (guard.toastRich) { this.toast('toast.richLater'); return; }
    if (this.inlineEditor.isEditing()) {
      if (action === 'bold' || action === 'italic' || action === 'underline') { this.applyInlineWrap(action); return; }
      if (action === 'link') { void this.applyInlineLink(); return; }
    }
    if (!guard.execute) return;
    switch (action) {
      case 'undo': this.session.history.undo(); this.toast('toast.undo'); break;
      case 'save': this.saveDraft(); break;
      case 'redo': this.session.history.redo(); this.toast('toast.redo'); break;
      case 'open': this.fileInput.click(); break;
      case 'delete': this.deleteSelected(); break;
      case 'duplicate': this.duplicateSelected(); break;
      case 'toggleLock': { const sel = this.session.selection.elements[0]; if (sel) this.toggleLock(sel); break; }
      case 'nudge': this.nudgeByArrowKey(e); break;
      case 'escape': if (this.formatPainter.isActive()) this.formatPainter.exit(); else this.clearSelection(); this.menu.hide(); break;
      case 'bold': case 'italic': case 'underline': this.applyTextStyle(action); break;
      case 'link': void this.applyInlineLink(); break;
      default: break;
    }
  }

  /** 方向键微移，每次按键 push 一个 MoveCommand。 */
  private nudgeByArrowKey(e: KeyboardEvent): void {
    const session = this.session;
    const sel = session?.selection.elements[0];
    if (!session || !sel || !sel.isConnected) return;
    if (this.lock.isLocked(sel)) return;
    const step = e.shiftKey ? INTERACTION.NUDGE_BIG_PX : INTERACTION.NUDGE_PX;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      default:
        return;
    }
    e.preventDefault();
    session.history.push(new MoveCommand([sel], dx, dy));
    session.markDirty();
  }


  // ── 预览 ──────────────────────────────────────────────────
  private editScrollX = 0;
  private editScrollY = 0;
  private togglePreview(): void {
    if (!this.session) {
      this.toast('toast.noDocument');
      return;
    }
    if (!this.previewOpen) {
      if (this.inlineEditor.isEditing()) this.inlineEditor.commit();
      this.editScrollX = this.canvas.getScrollX();
      this.editScrollY = this.canvas.getScrollY();
      const { html } = this.io.serialize(this.session.doc, { stripEditorArtifacts: true });
      void this.preview.open(html).then(() => {
        this.canvas.setHidden(true);
        this.previewOpen = true;
        this.toast('toast.previewOn');
      });
    } else {
      void this.preview.extract().then((extracted) => {
        this.preview.destroy();
        this.canvas.setHidden(false);
        this.previewOpen = false;
        this.toast('toast.previewOff');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          this.canvas.setScroll(this.editScrollX, this.editScrollY);
        }));
        if (extracted) this.syncFormValues(extracted);
      });
    }
  }

  private syncFormValues(extracted: string): void {
    try {
      const prevDoc = new DOMParser().parseFromString(extracted, 'text/html');
      const doc = this.session!.doc;
      const selectors = ['input', 'textarea', 'select'];
      for (const sel of selectors) {
        const editors = Array.from(doc.querySelectorAll(sel));
        const prevs = Array.from(prevDoc.querySelectorAll(sel));
        editors.forEach((el, i) => {
          const prev = prevs[i] as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) | undefined;
          if (!prev) return;
          if (el instanceof HTMLInputElement) {
            el.value = (prev as HTMLInputElement).value;
            if (el.type === 'checkbox' || el.type === 'radio') {
              el.checked = (prev as HTMLInputElement).checked;
            }
          } else if (el instanceof HTMLTextAreaElement) {
            el.value = (prev as HTMLTextAreaElement).value;
          } else if (el instanceof HTMLSelectElement) {
            el.value = (prev as HTMLSelectElement).value;
          }
        });
      }
      this.session!.markDirty();
    } catch { /* best-effort */ }
  }
  // ── 导出 ──────────────────────────────────────────────────
  private exportHtml(): void {
    if (!this.session) {
      this.toast('toast.noDocument');
      return;
    }
    const { html, residue } = this.io.serialize(this.session.doc, { stripEditorArtifacts: true });
    if (residue.length > 0) {
      throw new EditorError('EP.IO.RESIDUE', 'toast.residue', {
        recoverable: true,
        hint: residue.map((r) => `${r.kind}:${r.detail}`).join('; '),
      });
    }
    this.download(html, this.session.meta.fileName || 'edited.html');
    // 导出资源审计（T116）：blob: 与外链资源在换机/离线场景会失效，只提示不阻断导出。
    const risky = auditResources(this.session.doc).filter((w) => w.kind !== 'data').length;
    this.toast(risky > 0 ? 'toast.exportOkWithExternal' : 'toast.exportOk');
  }

  /** 渲染草稿区：无草稿只留占位；有草稿给「继续 / 删除」入口。 */
  private refreshDraftList(): void {
    this.draftRow.textContent = '';
    const rec = loadDraft();
    if (!rec) {
      this.draftRow.textContent = t('draft.none');
      return;
    }
    const span = document.createElement('span');
    span.textContent = `${t('draft.recentPrefix')}${rec.title} ${new Date(rec.updatedAt).toLocaleString()}`;
    const resume = this.makeButton(t('button.resume'), () => {
      void this.importSource(rec.html, 'draft', rec.title).catch((err) => this.handleError(err));
    });
    const del = this.makeButton(t('button.delete'), () => { clearDraft(); this.refreshDraftList(); });
    this.draftRow.append(span, resume, del);
  }

  private loadBlank(): void {
    // 空白模板属「文档内容」而非界面文案，按契约不进 i18n
    const blank = '<!DOCTYPE html><html><head><title>未命名</title></head><body><p>开始编辑…</p></body></html>';
    this.textarea.value = blank;
    this.importFromTextarea();
  }

  private async copyHtml(): Promise<void> {
    if (!this.session) { this.toast('toast.noDocument'); return; }
    const { html, residue } = this.io.serialize(this.session.doc, { stripEditorArtifacts: true });
    if (residue.length > 0) {
      throw new EditorError('EP.IO.RESIDUE', 'toast.residue', {
        recoverable: true,
        hint: residue.map((r) => `${r.kind}:${r.detail}`).join('; '),
      });
    }
    try {
      await navigator.clipboard.writeText(html);
      this.toast('toast.exportOk');
    } catch {
      this.toast('toast.clipboardFail');
    }
  }

  private saveDraft(): void {
    if (!this.session) { this.toast('toast.noDocument'); return; }
    const { html, residue } = this.io.serialize(this.session.doc, { stripEditorArtifacts: true });
    if (residue.length > 0) { this.toast('toast.residue'); return; }
    const r = saveDraft(html, this.session.meta.fileName || '未命名');
    if (r === 'ok') {
      this.toast('toast.draftSaved');
      // 同步刷新草稿区：否则存完草稿，界面上仍显示「无草稿」，用户无法当场恢复
      this.refreshDraftList();
    } else if (r === 'too-large') this.toast('toast.draftTooLarge');
    else this.toast('toast.draftFail');
  }

  private download(html: string, name: string): void {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── toast / 错误 ─────────────────────────────────────────
  private toast(key: Parameters<typeof t>[0]): void {
    this.toastEl.textContent = t(key);
  }

  private handleError(err: unknown): void {
    if (err instanceof EditorError && err.code === 'EP.IO.RESIDUE') {
      this.toast('toast.residue');
      return;
    }
    this.toast('toast.exportFailed');
  }
}

/** 装配根（composition root）：构造适配器并注入 App。 */
export function createApp(root: HTMLElement): App {
  const app = new App(root, { io: new DomParserIO() });
  app.mount();
  return app;
}
