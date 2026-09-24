// 编辑态画布（契约 01 §5）：
//   - 编辑 iframe id="ep-canvas-frame"，sandbox 逐字为 "allow-same-origin"（绝不含 allow-scripts）。
//   - 外壳 #ep-overlay-root（T103 接 hover 高亮框/选中框）。
//   - 在编辑文档上监听 pointermove/pointerdown/scroll，跨 realm 用 nodeType===1 判定。

import { EP } from '../../constants';
import { zoomOf } from '../../core/interaction/zoom';

/** 就地编辑态样式表 id。`ep-` 前缀是导出清理的识别依据，不可改。 */
const EDITING_STYLE_ID = 'ep-inline-edit-style';

export class CanvasHost {
  readonly frame: HTMLIFrameElement;
  readonly overlay: HTMLDivElement;
  private dblClickHandler: ((el: Element) => void) | null = null;
  private hoverHandler: ((el: Element) => void) | null = null;
  private selectHandler: ((el: Element, shiftKey: boolean) => void) | null = null;
  private blankDownHandler: ((e: PointerEvent) => void) | null = null;
  private layoutHandler: (() => void) | null = null;
  private leaveHandler: (() => void) | null = null;
  private rafId = 0;

  constructor(host: HTMLElement) {
    host.style.position = 'relative';
    this.frame = document.createElement('iframe');
    this.frame.id = EP.CANVAS_FRAME;
    // 安全红线：逐字 "allow-same-origin"，绝不加 allow-scripts
    this.frame.setAttribute('sandbox', 'allow-same-origin');
    // 尺寸不再内联（批次 1 · R3）：画布改为填满可用高度、宽度随容器自适应，
    // 由 style/app.css 的 #ep-canvas-frame（width:100% / height:100%）承担；
    // 缩放时由 ZoomController 显式写内联，且缩放为 100% 时会清回 CSS 值。
    // 几何基准仍是本 frame 的 getBoundingClientRect()，只是不再钉死在 600px 常量上。
    host.appendChild(this.frame);

    this.overlay = document.createElement('div');
    this.overlay.id = EP.OVERLAY_ROOT;
    host.appendChild(this.overlay);

    // window resize 只在构造时挂一次；loadHtml 重载不再重复挂载，避免监听器累积
    window.addEventListener('resize', () => this.requestLayout());
  }

  get contentDocument(): Document | null {
    return this.frame.contentDocument;
  }

  /**
   * 当前缩放比（R2）。由 ZoomController 写在 dataset 上，是
   * 选中框贴合 / 吸附线落位 / 手柄拖拽换算的唯一来源 —— 见 core/interaction/zoom。
   */
  get zoom(): number {
    return zoomOf(this.frame);
  }

  /** 把原始 HTML 经 srcdoc 写入编辑 iframe，等 load 完成后挂载监听并返回 contentDocument。 */
  loadHtml(source: string): Promise<Document> {
    return new Promise<Document>((resolve, reject) => {
      this.frame.addEventListener(
        'load',
        () => {
          const cd = this.frame.contentDocument;
          if (!cd) {
            reject(new Error('编辑 iframe 尚未就绪'));
            return;
          }
          this.attachListeners(cd);
          resolve(cd);
        },
        { once: true },
      );
      this.frame.srcdoc = source;
    });
  }

  onDblClick(handler: (el: Element) => void): void {
    this.dblClickHandler = handler;
  }
  onHover(handler: (el: Element) => void): void {
    this.hoverHandler = handler;
  }
  /**
   * 指针离开画布（T123）。没有这个回调时 hover 高亮会一直留在上一次悬停的元素上 ——
   * 用户把鼠标移回顶栏调样式时，画布上那圈高亮框始终不退，正好挡住要看的效果。
   */
  onLeave(handler: () => void): void {
    this.leaveHandler = handler;
  }
  onSelect(handler: (el: Element, shiftKey: boolean) => void): void {
    this.selectHandler = handler;
  }
  onBlankDown(handler: (e: PointerEvent) => void): void {
    this.blankDownHandler = handler;
  }
  onLayout(handler: () => void): void {
    this.layoutHandler = handler;
  }

  private attachListeners(cd: Document): void {
    this.injectEditingStyle(cd);

    // 双击就地改字
    cd.addEventListener('dblclick', (e) => {
      const target = e.target as Node | null;
      if (target && target.nodeType === 1) {
        this.dblClickHandler?.(target as Element);
      }
    });

    // pointermove：rAF 节流，hover 高亮跟随
    cd.addEventListener('pointermove', (e) => {
      const target = e.target as Node | null;
      if (!target || target.nodeType !== 1) return;
      const el = target as Element;
      if (this.rafId) return; // 已有待处理帧
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        this.hoverHandler?.(el);
      });
    });

    // pointerleave 不冒泡，挂在 document 上收不到 —— 必须挂 documentElement。
    // 指针移出画布（去顶栏 / 去面板）时立即清掉 hover 高亮（T123）。
    cd.documentElement.addEventListener('pointerleave', () => {
      this.leaveHandler?.();
    });

    // pointerdown：命中元素选中；空白（body/html）清空
    cd.addEventListener('pointerdown', (e) => {
      const target = e.target as Node | null;
      if (!target || target.nodeType !== 1) return;
      const el = target as Element;
      if (el === cd.body || el === cd.documentElement) {
        this.blankDownHandler?.(e);
      } else {
        this.selectHandler?.(el, e.shiftKey);
      }
    });

    // 画布内禁止任何导航：<a href> 的 click/auxclick 与 <form> 的 submit 会让编辑帧跳到目标页，
    // 覆盖掉 srcdoc 里的编辑文档，画布当场失效且无返回路径。捕获阶段拦截默认动作，
    // 但不 stopPropagation —— 选中与 dblclick 处理器必须继续工作。
    const blockNav = (e: Event): void => {
      const t = e.target as Node | null;
      if (t && t.nodeType === 1 && (t as Element).closest('a[href], area[href]')) e.preventDefault();
    };
    cd.addEventListener('click', blockNav, true);
    cd.addEventListener('auxclick', blockNav, true);
    cd.addEventListener('submit', (e) => e.preventDefault(), true);

    // 编辑文档内滚动（捕获，含子元素滚动）后重定位；window resize 已在构造时挂载一次
    cd.addEventListener('scroll', () => this.requestLayout(), true);
  }

  /**
   * 就地编辑态视觉高亮（T122）。原实现双击进入 contenteditable 后，除了文本光标
   * 没有任何提示 —— 用户不知道当前处于编辑态、也不知道 Esc 可取消。
   *
   * 用 `[data-ep-editing]` 属性选择器，不往元素上挂 class；outline 不参与布局，
   * 因此不影响 e2e 的坐标基准（拖拽 / 缩放 / 吸附）。
   *
   * ⚠️ 这个 <style id="ep-..."> 会被导出清理的第 ④ 类规则摘除
   *    （见 core/serialize/stripArtifacts：style[id^="ep-"] / script[id^="ep-"]）。
   */
  private injectEditingStyle(cd: Document): void {
    if (cd.getElementById(EDITING_STYLE_ID)) return;
    const style = cd.createElement('style');
    style.id = EDITING_STYLE_ID;
    // 虚线 + 强调色：与外壳的实线选中框（--ep-selected #2f6bff）区分开
    style.textContent = `[${EP.EDITING_ATTR}] { outline: 2px dashed #2f6bff; outline-offset: 2px; }`;
    (cd.head ?? cd.documentElement).appendChild(style);
  }

  private requestLayout(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.layoutHandler?.();
    });
  }

  /** 预览期间隐藏不销毁（仅 display:none，不 removeChild）。 */
  setHidden(hidden: boolean): void {
    this.frame.style.display = hidden ? 'none' : '';
  }

  getScrollX(): number { return this.frame.contentWindow?.scrollX ?? 0; }
  getScrollY(): number { return this.frame.contentWindow?.scrollY ?? 0; }
  setScroll(x: number, y: number): void { this.frame.contentWindow?.scrollTo(x, y); }
}
