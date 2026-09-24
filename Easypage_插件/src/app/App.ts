// 应用外壳（契约 01 §3 app/）：顶部三按钮 + 粘贴 textarea + 文件 input + toast。
// 边界 try/catch，异常 toast 走 i18n key，不白屏。本卡用原生 DOM，不引框架。

import { t } from './i18n/zh-CN';
import { saveDraft, loadDraft, clearDraft } from '../core/stores/draft';
import type {
  AppPlatform,
  EditorSession,
  HtmlIO,
  InteractionAdapter,
  PreviewSandbox,
  SessionMeta,
} from '../core/ports';
import { EditorError } from '../core/EditorError';
import { EditorSessionModel } from '../core/model/EditorSession';
import { SetTextCommand, ResizeCommand } from '../core/commands/commands';
import { InlineWrapCommand } from '../core/commands/inlineCommands';
import { checkSelection, findEnclosingWrap } from '../core/inline/wrapInline';
import { INTERACTION, UI, VIEW } from '../constants';
import { isResizable } from '../core/interaction/resizeGuard';
import { clearTranslate } from '../core/interaction/transform';
import { computeResize, type ResizeDirection } from '../core/interaction/resize';
import { sanitizeImport } from '../core/io/sanitizeImport';
import { auditResources } from '../core/serialize/resourceAudit';
import { frameToOverlay, hoverFillAllowed, isDocumentRoot, rectOf, rectsIntersect } from './canvas/geom';
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
import { loadLayout, persistLayout, type UiLayoutState } from './layout/UiLayout';
import { iconButton, type IconName } from './ui/icons';
import { loadViewPrefs, persistViewPrefs, type ViewPrefs } from './ui/ViewPrefs';
import { ZoomController } from './canvas/ZoomController';
import { ContextToolbar } from './canvas/ContextToolbar';
import { PreviewOverlay } from './preview/PreviewOverlay';

export class App {
  private readonly root: HTMLElement;
  private readonly platform: AppPlatform;
  private readonly io: HtmlIO;
  private canvas!: CanvasHost;
  private preview!: PreviewSandbox;
  private overlay!: OverlayLayer;
  private breadcrumb!: Breadcrumb;
  private inlineEditor!: InlineTextEditor;
  private session!: EditorSession;
  private interaction!: InteractionAdapter;
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
  /** 顶栏「预览」按钮（切换激活态用）。 */
  private previewBtnEl: HTMLButtonElement | null = null;

  private textarea!: HTMLTextAreaElement;
  private fileInput!: HTMLInputElement;
  /** 对齐/分布按钮。T122：按选中数禁用，避免「看起来可用、点了才说不够」的误导。 */
  private alignButtons: HTMLButtonElement[] = [];
  private draftRow!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  /** 提示条自动收起计时器（T122）。 */
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private canvasHostEl!: HTMLDivElement;
  /** 预览宿主：批次 1 · R1 起是覆盖层内的舞台（不再是排在 .ep-main 之后的入流块）。 */
  private previewOverlay!: PreviewOverlay;
  private zoom!: ZoomController;
  private ctxbar!: ContextToolbar;
  private statusbarEl!: HTMLDivElement;
  private importOverlay!: HTMLDivElement;
  /** 左右面板开合（持久化，默认收起 —— 方案 C 画布优先）。 */
  private layout: UiLayoutState = loadLayout();
  /** 视图偏好：画布自动适应宽度、属性分组展开态（批次 1）。 */
  private viewPrefs: ViewPrefs = loadViewPrefs();
  /** 导入浮层的手动开关；无文档时强制可见（空状态引导），此值不起作用。 */
  private importOpen = true;

  /**
   * @param platform 平台装配（由 platforms/** 提供）。app 层只依赖 core 端口类型，
   *                 不直接 import 任何适配器实现 —— 见契约 §4 与 .eslintrc.cjs 的 import 边界。
   */
  constructor(root: HTMLElement, platform: AppPlatform) {
    this.root = root;
    this.platform = platform;
    this.io = platform.createIO();
  }

  mount(): void {
    this.root.textContent = '';

    // ── 顶栏（C 版：品牌 + 一级动作平铺，无描边无底色，hover 才显形）──
    // ⚠️ 品牌节点必须保持 <h1> 标签。tests/e2e 有 20+ 处
    //    `page.locator('h1').first().click()`，其真实意图是「点一下画布外，
    //    把键盘焦点从 iframe 收回主文档」，而 page.locator 不穿透 iframe，
    //    所以命中这个外壳 h1 而非画布内的 h1。改标签名会让这批测试集体失败。
    //    （技术债：这个隐式耦合应改为显式锚点，见提交说明。）
    const topbar = document.createElement('div');
    topbar.className = 'ep-topbar';
    const brand = document.createElement('div');
    brand.className = 'ep-topbar__brand';
    const title = document.createElement('h1');
    title.className = 'ep-topbar__name';
    title.textContent = t('app.title');
    brand.appendChild(title);
    topbar.appendChild(brand);

    // 工具栏（一级动作）
    // 注意：「导入 HTML」这个提交按钮在导入浮层里，不在顶栏 —— 顶栏的对应入口是
    // 「粘贴 HTML」（唤起浮层）。理由是 getByRole 的 name 为子串匹配，
    // 两个按钮不能叫同一个名字（会命中 2 个元素触发 strict mode 违规）。
    // 工具栏（批次 1 · R5）。
    // 【为什么分组】E8 走查指出：原 7 个按钮只靠品牌后一条竖线分隔，「导入类 / 输出类 /
    //   工具类 / 视图类」四种语义混作一团。现拆成 文件 / 编辑 / 视图 / 输出 四段。
    // 【图标与文字的分工】高频入口（粘贴 / 新建 / 预览 / 导出）保留可见文案，一眼可读；
    //   工具类（撤销 / 重做 / 复制 / 重置位移 / 格式刷）走纯图标 + tooltip，
    //   避免 11 个按钮把 1280 视口下的工具栏挤爆。
    // 【可访问名不变】有没有可见文案，名字都由同一份 label 承担（纯图标时进 .ep-sr-only）。
    //   这是让 20 个 spec 的 getByRole 锚点零改动的前提。
    const toolbar = document.createElement('div');
    toolbar.className = 'ep-toolbar';

    const fileGroup = this.makeToolGroup();
    const pasteBtn = this.makeIconButton('paste', t('button.pasteHtml'), t('button.pasteHint'), () => this.toggleImportOverlay(), true);
    const blankBtn = this.makeIconButton('filePlus', t('button.blank'), t('button.blankHint'), () => this.loadBlank(), true);
    fileGroup.append(pasteBtn, blankBtn);

    const editGroup = this.makeToolGroup();
    const undoBtn = this.makeIconButton('undo', t('button.undo'), t('button.undoHint'), () => { this.session?.history.undo(); });
    const redoBtn = this.makeIconButton('redo', t('button.redo'), t('button.redoHint'), () => { this.session?.history.redo(); });
    const copyBtn = this.makeIconButton('copy', t('button.copyHtml'), t('button.copyHint'), () => { void this.copyHtml(); });
    const resetBtn = this.makeIconButton('resetMove', t('button.resetTransform'), t('button.resetHint'), () => this.resetTransform());
    const painterBtn = this.makeIconButton('brush', t('button.formatPainter'), t('button.painterHint'), () => this.formatPainter.startOnce());
    painterBtn.addEventListener('dblclick', () => this.formatPainter.startContinuous());
    editGroup.append(undoBtn, redoBtn, copyBtn, resetBtn, painterBtn);

    const viewGroup = this.makeToolGroup();
    const previewBtn = this.makeIconButton('play', t('button.preview'), t('button.previewHint'), () => this.togglePreview(), true);
    this.previewBtnEl = previewBtn;
    viewGroup.append(previewBtn);

    const outGroup = this.makeToolGroup();
    const exportBtn = this.makeIconButton('download', t('button.export'), t('button.exportHint'), () => this.exportHtml(), true);
    outGroup.append(exportBtn);

    toolbar.append(fileGroup, editGroup, viewGroup, outGroup);
    topbar.appendChild(toolbar);

    // 面板开关（C 版：左右面板默认收起，按需滑出）
    const panelGroup = document.createElement('div');
    panelGroup.className = 'ep-topbar__panels';
    const leftToggle = this.makePanelToggle(t('panel.toggleLeft'), 'left', t('panel.toggleLeftHint'));
    const rightToggle = this.makePanelToggle(t('panel.toggleRight'), 'right', t('panel.toggleRightHint'));
    panelGroup.append(leftToggle, rightToggle);
    topbar.appendChild(panelGroup);
    this.root.appendChild(topbar);

    // 对齐/分布按钮组（T113）—— C 版：贴着画布顶部浮动，故挂到画布列内（见下）。
    // 刻意留在文档流内而非 position:absolute：绝对浮层会遮住画布顶部 ~36px，
    // 而 e2e 大量直接点击画布元素，被遮挡会命中失败。视觉上用胶囊 + 阴影做出「浮动」感。
    // 批次 1 · R5：按钮改纯图标 + tooltip（可访问名不变，进 .ep-sr-only），
    //   8 个按钮的宽度由实测 509px 收到约 280px，窄视口下不必再换行。
    const alignRow = document.createElement('div');
    alignRow.className = 'ep-alignbar';
    const mkAlign = (label: string, hint: string, iconName: IconName, type: AlignType) => {
      const b = this.makeIconButton(iconName, label, hint, () => this.doAlign(type));
      b.dataset.align = type;
      this.alignButtons.push(b);
      return b;
    };
    alignRow.append(
      mkAlign(t('align.left'), t('align.leftHint'), 'alignLeft', 'left'),
      mkAlign(t('align.right'), t('align.rightHint'), 'alignRight', 'right'),
      mkAlign(t('align.hcenter'), t('align.hcenterHint'), 'alignHCenter', 'hcenter'),
      mkAlign(t('align.top'), t('align.topHint'), 'alignTop', 'top'),
      mkAlign(t('align.bottom'), t('align.bottomHint'), 'alignBottom', 'bottom'),
      mkAlign(t('align.vcenter'), t('align.vcenterHint'), 'alignVCenter', 'vcenter'),
      mkAlign(t('align.hdistribute'), t('align.hdistributeHint'), 'distributeH', 'hdistribute'),
      mkAlign(t('align.vdistribute'), t('align.vdistributeHint'), 'distributeV', 'vdistribute'),
    );

    // 上下文工具条（R4）：与对齐条同行、同处文档流内 —— 两者都不遮画布一个像素。
    // 落地形态的取舍原因见 canvas/ContextToolbar.ts 文件头。
    this.ctxbar = new ContextToolbar({
      getSelection: () => [...(this.session?.selection.elements ?? [])],
      isLocked: (el) => this.lock.isLocked(el),
      setFontSize: (px) => this.commitStyleValues({ fontSize: `${px}px` }),
      setColor: (hex) => this.commitStyleValues({ color: hex }),
      duplicate: () => this.duplicateSelected(),
      toggleLock: () => {
        const sel = this.session?.selection.elements[0];
        if (sel) this.toggleLock(sel);
      },
      remove: () => this.deleteSelected(),
    });

    // ── 导入浮层（C 版空状态引导 + 顶栏「粘贴 HTML」按需唤起）──
    // 无文档时强制可见（大面积留白 + 中央输入区，界面存在感最低）；
    // 导入成功后收起，把视野让给画布。
    this.importOverlay = document.createElement('div');
    this.importOverlay.className = 'ep-import-overlay';
    const importCard = document.createElement('div');
    importCard.className = 'ep-import-card';

    const importTitle = document.createElement('h2');
    importTitle.className = 'ep-import__title';
    importTitle.textContent = t('import.title');
    const importHint = document.createElement('p');
    importHint.className = 'ep-import__hint';
    importHint.textContent = t('import.hint');
    importCard.append(importTitle, importHint);

    // 草稿区（T117）：有草稿时渲染「继续 / 删除」，无草稿只留占位。
    // 注意：这一段曾在重构中丢失（draftRow 只声明未挂载），导致 Ctrl+S 存下的草稿
    // 在重新打开后没有任何恢复入口 —— 这是「草稿续开」失效的根因。
    // 类名原为 ep__draft-row（双下划线，与 EP.CLASS_PREFIX 的 BEM 约定不符），已统一。
    this.draftRow = document.createElement('div');
    this.draftRow.id = 'ep-draft-row';
    this.draftRow.className = 'ep-draft-row';
    importCard.appendChild(this.draftRow);
    this.refreshDraftList();

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'ep-import__textarea';
    this.textarea.placeholder = t('placeholder.pasteHtml');
    this.textarea.setAttribute('aria-label', 'placeholder.pasteHtml');
    importCard.appendChild(this.textarea);

    const importActions = document.createElement('div');
    importActions.className = 'ep-import__actions';
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.html,text/html';
    this.fileInput.className = 'ep-import__file';
    this.fileInput.addEventListener('change', () => this.importFromFile());
    // 唯一的「导入 HTML」提交按钮。必须留在浮层内：getByRole 的 name 子串匹配下，
    // 顶栏再放一个同名按钮会命中 2 个元素。
    const importBtn = this.makeButton(t('button.import'), () => this.importFromTextarea());
    importBtn.classList.add('ep-btn--primary');
    // 原生 file 控件在 Chromium 下渲染成英文「Choose File / No file chosen」，
    // 文案无法本地化、样式也无法完全接管（T122 走查发现）。改为视觉隐藏原生控件，
    // 用自定义「选择文件」按钮代理触发 —— i18n 里的 button.chooseFile 至此才真正被使用。
    // ⚠️ 控件必须留在 DOM 中：e2e 用 locator('input[type=file]').setInputFiles() 直接喂文件，
    //    该 API 不要求元素可见。
    const chooseBtn = this.makeButton(t('button.chooseFile'), () => this.fileInput.click());
    importActions.append(chooseBtn, this.fileInput, importBtn);
    importCard.appendChild(importActions);

    this.importOverlay.appendChild(importCard);
    this.root.appendChild(this.importOverlay);

    // 左元素面板 +（编辑 iframe + overlay）+ 右侧样式面板
    const outerRow = document.createElement('div');
    outerRow.className = 'ep-main';
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

    // 画布列：工具条带（对齐 + 上下文）→ 画布 → 底部行（面包屑 + 缩放控件），纵向排布。
    // 右侧样式面板仍是 .ep-canvas-row 的兄弟。
    // display/align-items 交给 style/app.css 的 .ep-canvas-row（视觉层），此处只搭结构。
    const mainRow = document.createElement('div');
    mainRow.className = 'ep-canvas-row';
    outerRow.appendChild(mainRow);
    const canvasCol = document.createElement('div');
    canvasCol.className = 'ep-canvas-col';
    mainRow.appendChild(canvasCol);
    // 工具条带（R4/R5）：两条都留在文档流内，不遮画布任何像素。
    const toolstrip = document.createElement('div');
    toolstrip.className = 'ep-toolstrip';
    toolstrip.append(alignRow, this.ctxbar.el);
    canvasCol.appendChild(toolstrip);
    this.canvasHostEl = document.createElement('div');
    this.canvasHostEl.className = 'ep-canvas-host';
    canvasCol.appendChild(this.canvasHostEl);
    this.canvas = new CanvasHost(this.canvasHostEl);
    this.overlay = new OverlayLayer(this.canvas.overlay);
    this.overlay.onHandleStart((dir, e) => this.beginResize(dir, e));
    // 属性面板分组展开态（R7）与画布缩放偏好（R2）共用同一份持久化，
    // 因为二者都是「视图偏好」而非「文档状态」——换文档不该重置它们。
    this.stylePanel = new StylePanel(mainRow, {
      getSession: () => this.session,
      sectionOpen: (id, fallback) => this.viewPrefs.sections[id] ?? fallback,
      onSectionToggle: (id, open) => {
        this.viewPrefs = persistViewPrefs({
          sections: { ...this.viewPrefs.sections, [id]: open },
        });
      },
    });
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
    // 指针离开画布即撤销 hover 高亮，避免它滞留在最后悬停的元素上（T123）
    this.canvas.onLeave(() => this.overlay.setHover(null));
    this.canvas.onSelect((el: Element, shift: boolean) => this.onCanvasSelect(el, shift));
    this.canvas.onBlankDown((e: PointerEvent) => this.onBlankDown(e));
    this.marquee = new Marquee(this.canvas.overlay);

    this.menu = new ContextMenu(this.root);
    this.linkPopover = new LinkPopover(this.root);
    this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showMenu(e.clientX, e.clientY); });
    // 拖拽微移适配器：只在 committed 时 push 一个 MoveCommand
    this.interaction = this.platform.createInteraction(this.canvas.overlay, this.canvas.frame);
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

    // 预览覆盖层（批次 1 · R1）。改造前这里是一个 append 到根、排在 .ep-main 之后的
    // 入流 div，而 .ep-main{flex:1 1 auto} 撑满视高 ⇒ 预览帧从 y=900 起渲染、可见高度 0。
    // 现在是固定在顶栏下方的覆盖层，帧必然落在视口内；配套修掉 .ep-preview-host 的死 CSS。
    const previewOverlay = new PreviewOverlay({
      onClose: () => this.togglePreview(),
      onExport: () => this.exportHtml(),
    });
    this.previewOverlay = previewOverlay;
    this.root.appendChild(previewOverlay.el);
    this.preview = this.platform.createPreview(previewOverlay.stage);

    // 底部行：面包屑胶囊（左）+ 缩放控件（右）。
    // 面包屑仍是画布列内的文档流元素（不做 position:absolute），原因同对齐条：
    // 绝对浮层会遮住画布底部元素，而 e2e 的合成点击与真实点击都以坐标命中为准。
    // 缩放控件放这一行而不是画布右下角浮层，也是同一条理由（浮层会吃掉画布右下的点击）。
    const canvasFoot = document.createElement('div');
    canvasFoot.className = 'ep-canvas-foot';
    this.statusbarEl = document.createElement('div');
    this.statusbarEl.id = 'ep-breadcrumb';
    this.statusbarEl.className = 'ep-statusbar';
    canvasFoot.appendChild(this.statusbarEl);
    this.breadcrumb = new Breadcrumb(this.statusbarEl);
    this.breadcrumb.onPick((el) => { this.session?.selection.select([el]); });

    this.zoom = new ZoomController({
      host: this.canvasHostEl,
      frame: this.canvas.frame,
      isAutoFit: () => this.viewPrefs.autoFit,
      setAutoFit: (v) => { this.viewPrefs = persistViewPrefs({ autoFit: v }); },
      onChange: () => this.layoutOverlay(),
    });
    canvasFoot.appendChild(this.zoom.el);
    canvasCol.appendChild(canvasFoot);

    // toast
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'ep-toast';
    this.root.appendChild(this.toastEl);

    // 布局初值：面板开合来自持久化状态；无文档 ⇒ 导入浮层可见
    this.applyLayout();
    this.syncImportOverlay();
    // 无文档时先禁用对齐按钮，与「选中数不足即禁用」保持同一口径
    this.setAlignButtonsEnabled(0);
    // 首屏按偏好应用一次缩放（面板开合引起的尺寸变化由 ZoomController 的
    // ResizeObserver 接管，这里只处理「首屏即为展开态」的情形）。
    this.zoom.requestAutoFit();
  }

  // ── 布局状态（T121）────────────────────────────────────────
  /** 把 layout 状态同步到 DOM：#ep-app 的 data-left / data-right 驱动 CSS 收放。 */
  /**
   * 按当前选中数更新对齐/分布按钮的可用性（T122 走查修复）。
   *
   * 原行为：8 个按钮在任何选中状态下都呈可用外观，点了才弹「对齐需要至少 2 个元素」。
   * 走查中发现这与图层面板（↑↓ 按钮用 disabled 表达同一类前提）**两套处理方式**，
   * 属一致性问题，也属误导（按钮看起来能点）。
   *
   * 阈值：对齐类需 2 个元素，分布类需 3 个 —— 所以 2 个选中时分布类仍禁用，
   * 比单纯「全部可用/全部禁用」更精确。
   * 跨父元素的情况无法用 disabled 表达（要比较父节点），仍保留 doAlign 里的 toast 分支。
   */
  private setAlignButtonsEnabled(count: number): void {
    for (const b of this.alignButtons) {
      const type = b.dataset.align;
      const need = type === 'hdistribute' || type === 'vdistribute' ? 3 : 2;
      b.disabled = count < need;
    }
  }

  private applyLayout(): void {
    this.root.dataset.left = this.layout.left ? 'open' : 'closed';
    this.root.dataset.right = this.layout.right ? 'open' : 'closed';
    for (const b of Array.from(
      this.root.querySelectorAll<HTMLButtonElement>('.ep-topbar__toggle'),
    )) {
      const side = b.dataset.panel === 'right' ? 'right' : 'left';
      const open = this.layout[side];
      b.setAttribute('aria-pressed', String(open));
      b.classList.toggle('ep-btn--active', open);
    }
  }

  private togglePanel(side: 'left' | 'right'): void {
    this.layout = { ...this.layout, [side]: !this.layout[side] };
    persistLayout(this.layout);
    this.applyLayout();
  }

  private makePanelToggle(label: string, side: 'left' | 'right', hint: string): HTMLButtonElement {
    const btn = this.makeButton(label, () => this.togglePanel(side));
    btn.classList.add('ep-topbar__toggle');
    btn.dataset.panel = side;
    // 用 title 而非 aria-label 写提示：aria-label 会覆盖文本内容成为可访问名，
    // 而可访问名是 e2e 的定位锚点（getByRole 子串匹配），不能被提示文案污染。
    btn.title = hint;
    return btn;
  }

  /** 导入浮层显隐：无文档强制可见（空状态引导），有文档跟随手动开关。 */
  private syncImportOverlay(): void {
    const visible = !this.session || this.importOpen;
    this.importOverlay.dataset.open = visible ? 'true' : 'false';
  }

  private toggleImportOverlay(): void {
    // 空状态已在显示，无需切换；聚焦输入区即是最有用的响应。
    if (!this.session) {
      this.textarea.focus();
      return;
    }
    this.importOpen = !this.importOpen;
    this.syncImportOverlay();
    if (this.importOpen) this.textarea.focus();
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'ep-btn';
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

  /**
   * 图标按钮（批次 1 · R5）。包装成与 makeButton 相同的行为契约（异常一律走 toast，
   * 不白屏），差异只在可访问名的承载方式：文本进 `.ep-sr-only` span 而非直接可见。
   * 见 ui/icons.ts 的「可访问名红线」。
   */
  private makeIconButton(
    name: IconName,
    label: string,
    title: string,
    onClick: () => void,
    withText = false,
  ): HTMLButtonElement {
    return iconButton({
      icon: name,
      label,
      title,
      withText,
      onClick: () => {
        try {
          onClick();
        } catch (err) {
          this.handleError(err);
        }
      },
    });
  }

  /** 顶栏分组容器（R5）：组间以极浅竖线分隔，组内按钮紧凑排列。 */
  private makeToolGroup(): HTMLDivElement {
    const g = document.createElement('div');
    g.className = 'ep-toolgroup';
    return g;
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
      this.setAlignButtonsEnabled(els.length);
      if (els.length === 1 && els[0]) { this.refreshListButtons(els[0]); this.refreshLayers(); }
      else { this.elementsPanel.setListButtons(false, false, ''); this.refreshLayers(); }
    });
    this.overlay.setSelected(null);
    this.breadcrumb.render(null);
    this.refreshLayers();
    // 导入成功 ⇒ 收起导入浮层，把视野让给画布（C 版：界面存在感最低）
    this.importOpen = false;
    this.syncImportOverlay();
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

  /**
   * 上下文工具条（R4）的样式提交：与 StylePanel.commitStyle 同一套规约 ——
   * 快照初始内联值 → 写内联预览 → diff → 一条 SetStyleCommand，无变化不入栈。
   * 不复用 StylePanel 的实现是因为后者是私有方法且绑定面板自己的控件引用；
   * 两处都遵守同一份规约（无变化不入栈 + 一次撤销退整批），比强行抽取更清楚。
   */
  private commitStyleValues(props: Record<string, string>): void {
    const session = this.session;
    const els = [...(session?.selection.elements ?? [])];
    if (!session || els.length === 0) return;
    const prev = new Map<Element, Record<string, string>>();
    let changed = false;
    for (const el of els) {
      const before: Record<string, string> = {};
      for (const prop of Object.keys(props)) {
        before[prop] = ((el as HTMLElement).style[prop as never] as string) || '';
      }
      prev.set(el, before);
      for (const [prop, value] of Object.entries(props)) {
        (el as HTMLElement).style[prop as never] = value as never;
        if (before[prop] !== ((el as HTMLElement).style[prop as never] as string)) changed = true;
      }
    }
    if (!changed) return;
    session.history.push(new SetStyleCommand(els, props, prev));
    session.markDirty();
    // 重排覆盖层会顺带刷新样式面板与工具条，让两处显示与画布一致
    this.layoutOverlay();
  }

  private showMenu(x: number, y: number): void {
    const session = this.session;
    if (!session) return;
    const els = session.selection.elements;
    const single = els.length === 1 ? els[0]! : null;
    const locked = single ? this.lock.isLocked(single) : false;
    // T122：破坏性操作（删除）原先排在第一项，误点概率最高。现改为末位 + 分组 + danger 色。
    const items = [
      { id: 'duplicate', label: t('menu.duplicate'), enabled: !!single && !locked },
      { id: 'reset', label: t('menu.reset'), enabled: !!single && !locked },
      { id: 'toggleLock', label: locked ? t('menu.unlock') : t('menu.lock'), enabled: !!single },
      { id: 'delete', label: t('menu.delete'), enabled: els.length > 0 && !locked, danger: true, separatorBefore: true },
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

  private applyInlineWrap(action: 'bold' | 'italic' | 'underline'): void {    const session = this.session; if (!session) return;
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
    // 坐标链路（R2）：iframe 内 PointerEvent.clientX 是**渲染视口**坐标，
    // 屏幕坐标 = frameRect.left + clientX × zoom；覆盖层局部坐标 = 屏幕 − overlayRect.left。
    // 缩放 100% 时与改造前逐像素等价。
    // ⚠️ 顺手修正：原实现在起点里多减了一次 frameRect.left（覆盖层与画布同位置，
    //    减两次等于把框选起点左移一个画布宽），框选矩形始终偏离指针。此前无用例覆盖。
    const z = this.canvas.zoom;
    const frameRect = this.canvas.frame.getBoundingClientRect();
    const origin = this.canvas.overlay.getBoundingClientRect();
    const toLocalX = (clientX: number) => frameRect.left + clientX * z - origin.left;
    const toLocalY = (clientY: number) => frameRect.top + clientY * z - origin.top;
    const sx = toLocalX(e.clientX);
    const sy = toLocalY(e.clientY);
    this.marquee.begin(sx, sy, (rect) => {
      const doc = session.doc;
      const docRect = this.canvas.frame.getBoundingClientRect();
      const overlayRect = this.canvas.overlay.getBoundingClientRect();
      const mLeft = rect.left - overlayRect.left;
      const mTop = rect.top - overlayRect.top;
      const mRight = mLeft + rect.width;
      const mBottom = mTop + rect.height;
      const hits: Element[] = [];
      for (const child of Array.from(doc.body.children)) {
        if (child.nodeType !== 1) continue;
        const r = child.getBoundingClientRect();
        const cl = docRect.left + r.left * z - overlayRect.left;
        const ct = docRect.top + r.top * z - overlayRect.top;
        if (rectsIntersect(
          { left: mLeft, top: mTop, right: mRight, bottom: mBottom },
          { left: cl, top: ct, right: cl + r.width * z, bottom: ct + r.height * z },
        )) {
          hits.push(child);
        }
      }
      if (hits.length > 0) session.selection.select(hits);
    });
    const move = (ev: PointerEvent) => {
      this.marquee.move(toLocalX(ev.clientX), toLocalY(ev.clientY));
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
      // 缩放比（R2）：iframe 内坐标是渲染视口坐标，需要乘回缩放才是屏幕坐标。
      // 缩放 100% 时为 1，与改造前逐像素一致。
      this.canvas.zoom,
    );
  }

  private layoutHover(el: Element): void {
    if (this.previewOpen) return;
    // 文档根（html / body）不高亮：它的框恒等于整页，悬停空白区时命中的就是它，
    // 高亮 = 给整页套一圈 2px 蓝框 + 12% 蓝蒙层，内容颜色全被盖住（T123）。
    // 根仍可从面包屑选中，功能不减。
    if (isDocumentRoot(el)) {
      this.overlay.setHover(null);
      return;
    }
    const box = this.toOverlayBox(el);
    // 大容器只描边不填充：填充是给按钮 / 标题这类小元素用来辨认嵌套层级的，
    // 铺在整块分区上就变成遮挡（T123）。
    this.overlay.setHover(box, hoverFillAllowed(box, this.canvas.frame.getBoundingClientRect()));
  }

  /** 重定位选中框；元素已被删除则清空失效选中；同步拖拽适配器 attach/detach。 */
  private layoutOverlay(): void {
    // 上下文工具条（R4）的可用性由选中态唯一决定 —— 在 early return 之前刷新，
    // 否则「清空选中」这条路径上工具条会停在上一轮的启用外观。
    this.ctxbar.refresh();
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
    // 手柄的 pointermove 挂在外壳 window 上，clientX 是**屏幕**像素；元素宽高是
    // **iframe 内部**像素。缩放不 100% 时两者差一个缩放比，不除就会「拖 100px 涨 100px」，
    // 实际视觉涨幅被放大到 100/zoom（R2 之前无缩放，此处恒为 1）。
    const z = this.canvas.zoom;

    const move = (ev: PointerEvent): void => {
      const dx = (ev.clientX - startClientX) / z;
      const dy = (ev.clientY - startClientY) / z;
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
    // 缩放快捷键（R2）：纯视图操作，与「撤销 / 重做 / 格式」那套编辑命令不同类，
    // 因此不进 keymap 的动作表。必须放在 matchAction 之前 —— 否则 Ctrl+数字会被
    // 动作表判成 'none' 白白放行，浏览器还可能触发自己的缩放/标签页行为。
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        this.zoom.setZoom(this.zoom.zoom + VIEW.ZOOM_STEP, { user: true });
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        this.zoom.setZoom(this.zoom.zoom - VIEW.ZOOM_STEP, { user: true });
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        this.zoom.setZoom(1, { user: true });
        return;
      }
      if (e.key === '1') {
        e.preventDefault();
        this.zoom.fitWidth();
        return;
      }
    }
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
      // Esc（R1）：预览覆盖层打开时优先关预览 —— 它是当前最上层的界面，
      // 关掉它比清空一个被覆盖层挡住的选中态更符合预期。
      // 判据取覆盖层自身的可见状态（「预览界面正在显示」的权威信号），
      // 而不是 previewOpen 这个内部标志 —— 不依赖两者同步的约定。
      case 'escape':
        if (this.previewOverlay.isOpen()) { this.togglePreview(); break; }
        if (this.formatPainter.isActive()) this.formatPainter.exit(); else this.clearSelection();
        this.menu.hide();
        break;
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
  /**
   * 预览开关（批次 1 · R1）。
   *
   * 打开顺序刻意是「先开覆盖层，再等帧加载完」：点下按钮的下一帧用户就能看到
   * 覆盖层骨架，而不是对着旧界面等 iframe srcdoc 解析。画布直到帧可用才隐藏，
   * 避免中途出现两帧空白。
   *
   * 关闭时把画布滚动位置还原（帧在 display:none 期间会丢滚动），并把预览帧里
   * 用户填过的表单值回带到编辑文档 —— 两条都是改造前就有的行为，保留。
   */
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
      // ⚠️ 先置位、再开帧：previewOpen 与覆盖层的可见状态必须**同步**翻转。
      //    原先 previewOpen 在 preview.open() 的 then 里才置 true，于是「刚点开预览
      //    就再点一次 / 按 Esc」会读到 previewOpen === false 而走进「打开」分支 ——
      //    界面上覆盖层明明已经可见，操作却把它又开一次，表现为「点关关不掉」。
      this.previewOpen = true;
      this.previewOverlay.open();
      this.previewBtnEl?.classList.add('ep-btn--active');
      void this.preview.open(html).then(() => {
        // 画布刻意等到帧可用才隐藏：中途不会出现两帧空白。
        this.canvas.setHidden(true);
        this.toast('toast.previewOn');
      });
    } else {
      // 同理先置位：连按两次关（Esc 或顶栏按钮）不会重复走关闭分支。
      this.previewOpen = false;
      this.previewOverlay.close();
      this.previewBtnEl?.classList.remove('ep-btn--active');
      void this.preview.extract().then((extracted) => {
        this.preview.destroy();
        this.canvas.setHidden(false);
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
    // 拆成「标签 / 文件名 / 时间戳 / 操作」四段（T122 走查修复）。
    // 原实现把「最近草稿：<文件名> <完整时间戳> 继续 删除」拼成一整行文本：
    // 时间戳与文件名同权重、按钮紧跟其后，读起来是一坨，且文件名一长就整体换行。
    // 现在文件名可截断、时间戳降级弱化、操作区靠右对齐。
    // ⚠️「无草稿」分支仍是单一 textContent，startpage.spec 用 toHaveText('无草稿') 断言它，未受影响。
    const label = document.createElement('span');
    label.className = 'ep-draft__label';
    label.textContent = t('draft.recentPrefix');

    const name = document.createElement('span');
    name.className = 'ep-draft__name';
    name.textContent = rec.title;
    name.title = rec.title;

    const time = document.createElement('span');
    time.className = 'ep-draft__time';
    time.textContent = new Date(rec.updatedAt).toLocaleString();

    const actions = document.createElement('div');
    actions.className = 'ep-draft__actions';
    const resume = this.makeButton(t('button.resume'), () => {
      void this.importSource(rec.html, 'draft', rec.title).catch((err) => this.handleError(err));
    });
    const del = this.makeButton(t('button.delete'), () => { clearDraft(); this.refreshDraftList(); });
    actions.append(resume, del);

    this.draftRow.append(label, name, time, actions);
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
  /**
   * 提示条。T122：原实现只写 textContent、从不隐藏，导致
   * ① 首屏就有一个空的深色药丸悬在底部中央（空 div 的 padding 仍占位）；
   * ② 一旦提示过就永久驻留，后续提示叠字。
   * 现在按 `data-open` 显隐 + 自动收起。
   */
  private toast(key: Parameters<typeof t>[0]): void {
    this.toastEl.textContent = t(key);
    this.toastEl.dataset.open = 'true';
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.dataset.open = 'false';
      this.toastTimer = null;
    }, UI.TOAST_VISIBLE_MS);
  }

  private handleError(err: unknown): void {
    if (err instanceof EditorError && err.code === 'EP.IO.RESIDUE') {
      this.toast('toast.residue');
      return;
    }
    this.toast('toast.exportFailed');
  }
}
