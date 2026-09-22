// 格式刷（T110）：源元素白名单样式刷到目标；单次/连续模式；撤销聚合为一个 Batch。
// 节点不进被编辑文档，仅外壳交互。
import type { EditorSession, ICommand } from '../../core/ports';
import { BatchCommand, SetStyleCommand } from '../../core/commands/commands';
import { buildStyleProps, collectStyles } from '../../core/style/formatPaint';

export interface FormatPainterDeps {
  getSession: () => EditorSession | null;
  notify: (msgKey: string) => void;
  setCursor: (css: string) => void;
}

export class FormatPainter {
  private active = false;
  private continuous = false;
  private source: Element | null = null;
  private batched: ICommand[] = [];
  private session: EditorSession | null = null;

  constructor(private readonly deps: FormatPainterDeps) {}

  isActive(): boolean {
    return this.active;
  }

  /** 单击 = 单次模式。 */
  startOnce(): void {
    this.enter(false);
  }

  /** 双击 = 连续模式。 */
  startContinuous(): void {
    this.enter(true);
  }

  private enter(continuous: boolean): void {
    const session = this.deps.getSession();
    const src = session?.selection.elements[0];
    if (!session || !src) {
      this.deps.notify('toast.noDocument');
      return;
    }
    if (session.capabilities.of(src) !== 'full') {
      this.deps.notify(session.capabilities.reasonOf(src));
      return;
    }
    this.session = session;
    this.source = src;
    this.continuous = continuous;
    this.batched = [];
    this.active = true;
    this.deps.setCursor('copy');
  }

  /** 涂抹目标；返回 true 表示已被格式刷消费（App 不应再走普通选中/拖拽）。 */
  paint(target: Element): boolean {
    if (!this.active || !this.source || !this.session) return false;
    const session = this.session;
    if (session.capabilities.of(target) !== 'full') {
      this.deps.notify(session.capabilities.reasonOf(target));
      return true;
    }
    const css = (this.source.ownerDocument.defaultView ?? window).getComputedStyle(this.source);
    const props = buildStyleProps(collectStyles(css));
    const prev = new Map<Element, Record<string, string>>();
    const tgt = target as HTMLElement;
    const prevProps: Record<string, string> = {};
    for (const k of Object.keys(props)) prevProps[k] = tgt.style[k as never] as string;
    prev.set(target, prevProps);
    const cmd = new SetStyleCommand([target], props, prev);
    if (this.continuous) {
      cmd.execute();
      session.markDirty();
      this.batched.push(cmd);
    } else {
      session.history.push(new BatchCommand('format-paint', [cmd]));
      this.exit();
    }
    return true;
  }

  /** 退出会话：连续模式把累积命令聚合成一个 Batch 入栈。 */
  exit(): void {
    if (this.active && this.continuous && this.batched.length > 0 && this.session) {
      this.session.history.push(new BatchCommand('format-paint', this.batched));
      this.session.markDirty();
    }
    this.active = false;
    this.continuous = false;
    this.source = null;
    this.batched = [];
    this.session = null;
    this.deps.setCursor('');
  }
}
