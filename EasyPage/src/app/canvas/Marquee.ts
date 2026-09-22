// 框选矩形（T113）：外壳 ep- 节点，不进被编辑 doc。
// 在画布空白处 pointerdown 拖出矩形，pointerup 时回调相交元素。

import type { OverlayBox } from './geom';

export class Marquee {
  readonly root: HTMLDivElement;
  private box: HTMLDivElement;
  private active = false;
  private startX = 0;
  private startY = 0;
  private onEnd: ((rect: OverlayBox) => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ep-marquee-root';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40;';
    this.box = document.createElement('div');
    this.box.className = 'ep-marquee';
    this.box.style.cssText = 'position:absolute;border:1px solid #4285f4;background:rgba(66,133,244,0.15);display:none;';
    this.root.appendChild(this.box);
    host.appendChild(this.root);
  }

  begin(x: number, y: number, onEnd: (rect: OverlayBox) => void): void {
    this.active = true;
    this.startX = x;
    this.startY = y;
    this.onEnd = onEnd;
    this.box.style.display = 'block';
    this.box.style.left = `${x}px`;
    this.box.style.top = `${y}px`;
    this.box.style.width = '0px';
    this.box.style.height = '0px';
  }

  move(x: number, y: number): void {
    if (!this.active) return;
    const left = Math.min(this.startX, x);
    const top = Math.min(this.startY, y);
    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
    this.box.style.width = `${Math.abs(x - this.startX)}px`;
    this.box.style.height = `${Math.abs(y - this.startY)}px`;
  }

  end(): OverlayBox | null {
    if (!this.active) return null;
    this.active = false;
    const r = this.box.getBoundingClientRect();
    this.box.style.display = 'none';
    const rect: OverlayBox = { left: r.left, top: r.top, width: r.width, height: r.height };
    this.onEnd?.(rect);
    this.onEnd = null;
    return rect;
  }

  cancel(): void {
    this.active = false;
    this.onEnd = null;
    this.box.style.display = 'none';
  }
}
