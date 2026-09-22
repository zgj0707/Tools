// 编辑态画布（契约 01 §5）：
//   - 编辑 iframe id="ep-canvas-frame"，sandbox 逐字为 "allow-same-origin"（绝不含 allow-scripts）。
//   - 外壳 #ep-overlay-root（T103 接 hover 高亮框/选中框）。
//   - 在编辑文档上监听 pointermove/pointerdown/scroll，跨 realm 用 nodeType===1 判定。

import { EP } from '../../constants';

export class CanvasHost {
  readonly frame: HTMLIFrameElement;
  readonly overlay: HTMLDivElement;
  private dblClickHandler: ((el: Element) => void) | null = null;
  private hoverHandler: ((el: Element) => void) | null = null;
  private selectHandler: ((el: Element, shiftKey: boolean) => void) | null = null;
  private blankDownHandler: ((e: PointerEvent) => void) | null = null;
  private layoutHandler: (() => void) | null = null;
  private rafId = 0;

  constructor(host: HTMLElement) {
    host.style.position = 'relative';
    this.frame = document.createElement('iframe');
    this.frame.id = EP.CANVAS_FRAME;
    // 安全红线：逐字 "allow-same-origin"，绝不加 allow-scripts
    this.frame.setAttribute('sandbox', 'allow-same-origin');
    // 尺寸是几何红线（e2e 拖拽 / 缩放 / 选中框对齐的基准），保留内联；
    // 描边 / 圆角 / 底色 / display 由 style/app.css 的 #ep-canvas-frame 承担。
    this.frame.style.width = '100%';
    this.frame.style.height = '600px';
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
