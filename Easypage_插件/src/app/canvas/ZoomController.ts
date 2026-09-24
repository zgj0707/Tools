// 画布缩放（批次 1 · R2）。
//
// 【缩放语义 —— 与「把 iframe 缩小」不是一回事】
// 被编辑页面是流式布局，iframe 多宽它就按多宽排版。若只是 `scale()` 一缩，
// 页面依然按 700px 窄列 reflow，用户看到的是「一个变小的手机版」，不是「完整版面」。
// 因此本实现让 **视觉占位恒定 = 容器尺寸**，缩放只改变**渲染视口宽度**：
//
//     layoutW = 容器宽 / zoom          渲染视口（页面按这个宽度排版）
//     transform: scale(zoom)          视觉尺寸 = layoutW × zoom = 容器宽
//
// zoom = 50%  ⇒ 视口 2 倍容器宽 ⇒ 一屏看尽宽阔版面
// zoom = 100% ⇒ 视口 = 容器宽   ⇒ 与改造前逐像素一致（这是默认态，也是几何基准态）
// zoom = 150% ⇒ 视口 0.67 倍容器宽 ⇒ 放大看细节
//
// 【为什么 zoom = 100% 时必须清空 transform 与显式尺寸】
// e2e 的拖拽 / 缩放 / 吸附 / 选中框对齐全部以 `#ep-canvas-frame` 的
// getBoundingClientRect() 为基准。任何 transform 都会让 boundingBox 带上缩放，
// 哪怕是 scale(1) 也可能引入亚像素差。默认态回到「width:100% + 无 transform」，
// 等价于改造前的 DOM，20+ 处几何断言无需重算。

import { VIEW } from '../../constants';
import { icon, srOnly } from '../ui/icons';

export interface ZoomDeps {
  /** 画布宿主（.ep-canvas-host，尺寸即视觉可视区）。 */
  host: HTMLElement;
  /** 被缩放的编辑帧。 */
  frame: HTMLIFrameElement;
  /** 当前是否处于「自动适应宽度」模式。 */
  isAutoFit: () => boolean;
  /** 请求切换自动适应模式（用户点「适应宽度」= true；手动改缩放 = false）。 */
  setAutoFit: (v: boolean) => void;
  /** 缩放或画布尺寸变化后回调，用于重排覆盖层与刷新百分比显示。 */
  onChange: (zoom: number) => void;
}

export class ZoomController {
  /** 右下角缩放控件条。挂在画布下方与面包屑同行（不用绝对定位浮层 —— 会遮画布）。 */
  readonly el: HTMLElement;

  private readonly deps: ZoomDeps;
  private value = 1;
  private valueEl!: HTMLButtonElement;
  private observer: ResizeObserver | null = null;
  private pending = 0;

  constructor(deps: ZoomDeps) {
    this.deps = deps;

    this.el = document.createElement('div');
    this.el.className = 'ep-zoombar';

    const out = this.mkBtn('minus', '缩小', '缩小（Ctrl+−）', () => this.nudge(-VIEW.ZOOM_STEP));
    this.valueEl = document.createElement('button');
    this.valueEl.type = 'button';
    this.valueEl.className = 'ep-zoombar__value';
    this.valueEl.title = '恢复 100%（Ctrl+0）';
    this.valueEl.addEventListener('click', () => this.setZoom(1, { user: true }));
    const into = this.mkBtn('plus', '放大', '放大（Ctrl+＋）', () => this.nudge(VIEW.ZOOM_STEP));
    const fit = this.mkBtn('fitWidth', '适应宽度', '适应宽度（Ctrl+1）：整页宽度尽收眼底', () => this.fitWidth());

    this.el.append(out, this.valueEl, into, fit);
    this.syncValue();

    // 容器尺寸变化（面板开合 / 窗口缩放）⇒ 若处于自动模式则重算，否则仅重算渲染视口
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.requestApply());
      this.observer.observe(deps.host);
    }
  }

  get zoom(): number {
    return this.value;
  }

  private mkBtn(name: Parameters<typeof icon>[0], label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-btn ep-btn--icon ep-btn--sm';
    b.title = title;
    b.appendChild(icon(name, 14));
    b.appendChild(srOnly(label));
    b.addEventListener('click', onClick);
    return b;
  }

  /** 下一帧统一 apply，避免 ResizeObserver 一次抖动里连续写入。 */
  private requestApply(): void {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      if (this.deps.isAutoFit()) this.value = this.fitZoom();
      this.apply();
    });
  }

  /** 适应宽度：让 DESIGN_WIDTH 宽的版面完整落进可用宽度。容器够宽时不放大（上限 1）。 */
  private fitZoom(): number {
    const w = this.deps.host.clientWidth;
    if (!w) return this.value;
    return clamp(Math.min(1, w / VIEW.DESIGN_WIDTH));
  }

  fitWidth(): void {
    this.deps.setAutoFit(true);
    this.value = this.fitZoom();
    this.apply();
  }

  /** 面板开合后由 App 主动呼叫（ResizeObserver 之外的显式入口，便于测试与首屏）。 */
  requestAutoFit(): void {
    this.requestApply();
  }

  setZoom(z: number, opts: { user?: boolean } = {}): void {
    if (opts.user) this.deps.setAutoFit(false);
    this.value = clamp(z);
    this.apply();
  }

  private nudge(delta: number): void {
    this.setZoom(Math.round((this.value + delta) * 100) / 100, { user: true });
  }

  private apply(): void {
    const z = this.value;
    const { frame, host } = this.deps;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;

    if (z === 1) {
      // 默认态：与改造前的 DOM 完全一致（CSS 尺寸 + 无 transform）
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.transform = '';
      frame.style.transformOrigin = '';
      delete frame.dataset.zoom;
    } else {
      frame.style.width = `${w / z}px`;
      frame.style.height = `${h / z}px`;
      frame.style.transformOrigin = 'top left';
      frame.style.transform = `scale(${z})`;
      // 供 geom.zoomOf 读取：offsetWidth 是取整后的 layout 宽，用它反推 zoom 会有
      // 亚像素误差；直接写死比值，坐标换算才有确定值。
      frame.dataset.zoom = String(z);
    }
    this.syncValue();
    this.deps.onChange(z);
  }

  private syncValue(): void {
    const pct = `${Math.round(this.value * 100)}%`;
    if (this.valueEl.textContent !== pct) this.valueEl.textContent = pct;
    this.valueEl.title = `当前 ${pct} · 点击恢复 100%（Ctrl+0）`;
  }

  /** 释放 ResizeObserver。App 目前不销毁实例，留作端口完整性。 */
  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.pending) cancelAnimationFrame(this.pending);
    this.pending = 0;
  }
}

function clamp(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(VIEW.ZOOM_MAX, Math.max(VIEW.ZOOM_MIN, Math.round(z * 100) / 100));
}
