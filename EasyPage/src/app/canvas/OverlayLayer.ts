// 覆盖层（契约 01 §5）：在外壳 #ep-overlay-root 内画 hover 高亮框、选中框与 8 向缩放手柄。
// 所有节点都在外壳，绝不进入被编辑 doc。

import type { OverlayBox } from './geom';
import type { ResizeDirection } from '../../core/interaction/resize';

const HANDLE_SIZE = 9;
const DIRECTIONS: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function makeBox(id: string, borderColor: string): HTMLDivElement {
  const box = document.createElement('div');
  box.id = id;
  box.style.position = 'absolute';
  box.style.pointerEvents = 'none';
  box.style.border = `2px solid ${borderColor}`;
  box.style.boxSizing = 'border-box';
  box.style.display = 'none';
  box.style.zIndex = '20';
  return box;
}

export class OverlayLayer {
  private readonly root: HTMLDivElement;
  private readonly hoverBox: HTMLDivElement;
  private readonly selectedBox: HTMLDivElement;
  private readonly lockBadge: HTMLDivElement;
  private readonly handles = new Map<ResizeDirection, HTMLDivElement>();
  private handleStart: ((dir: ResizeDirection, e: PointerEvent) => void) | null = null;
  private handlesVisible = true;
  private locked = false;

  constructor(root: HTMLDivElement) {
    this.root = root;
    // 覆盖层铺满 iframe 区域，自身不拦截指针
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    this.root.style.pointerEvents = 'none';
    this.root.style.zIndex = '10';

    this.hoverBox = makeBox('ep-hover-box', 'rgba(66, 133, 244, 0.9)');
    this.hoverBox.style.background = 'rgba(66, 133, 244, 0.12)';
    this.selectedBox = makeBox('ep-selected-box', 'rgba(230, 81, 0, 0.95)');
    this.lockBadge = document.createElement('div');
    this.lockBadge.className = 'ep-lock-badge';
    this.lockBadge.textContent = '🔒';
    this.lockBadge.style.position = 'absolute';
    this.lockBadge.style.width = '14px';
    this.lockBadge.style.height = '14px';
    this.lockBadge.style.fontSize = '10px';
    this.lockBadge.style.lineHeight = '14px';
    this.lockBadge.style.textAlign = 'center';
    this.lockBadge.style.background = '#fff';
    this.lockBadge.style.border = '1px solid #999';
    this.lockBadge.style.borderRadius = '2px';
    this.lockBadge.style.display = 'none';
    this.lockBadge.style.zIndex = '35';
    this.root.appendChild(this.hoverBox);
    this.root.appendChild(this.selectedBox);
    this.root.appendChild(this.lockBadge);

    for (const dir of DIRECTIONS) {
      const h = document.createElement('div');
      h.dataset.dir = dir;
      h.style.position = 'absolute';
      h.style.width = `${HANDLE_SIZE}px`;
      h.style.height = `${HANDLE_SIZE}px`;
      h.style.background = 'rgba(230, 81, 0, 0.85)';
      h.style.border = '1px solid #fff';
      h.style.boxSizing = 'border-box';
      h.style.display = 'none';
      h.style.pointerEvents = 'auto';
      h.style.zIndex = '30';
      h.addEventListener('pointerdown', (e: PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        this.handleStart?.(dir, e);
      });
      this.root.appendChild(h);
      this.handles.set(dir, h);
    }
  }

  /** hover 高亮框（outer viewport 坐标，null 隐藏）。 */
  setHover(box: OverlayBox | null): void {
    this.apply(this.hoverBox, box);
  }

  /** 选中框（outer viewport 坐标，null 隐藏）；同时定位 8 手柄。 */
  setSelected(box: OverlayBox | null): void {
    this.apply(this.selectedBox, box);
    if (!box) {
      for (const h of this.handles.values()) h.style.display = 'none';
      return;
    }
    const origin = this.root.getBoundingClientRect();
    const bx = box.left - origin.left;
    const by = box.top - origin.top;
    const bw = box.width;
    const bh = box.height;
    const s = HANDLE_SIZE;
    const half = s / 2;
    const pos: Record<ResizeDirection, [number, number]> = {
      n: [bx + bw / 2 - half, by - half],
      s: [bx + bw / 2 - half, by + bh - half],
      e: [bx + bw - half, by + bh / 2 - half],
      w: [bx - half, by + bh / 2 - half],
      ne: [bx + bw - half, by - half],
      nw: [bx - half, by - half],
      se: [bx + bw - half, by + bh - half],
      sw: [bx - half, by + bh - half],
    };
    for (const dir of DIRECTIONS) {
      const h = this.handles.get(dir);
      const [x, y] = pos[dir];
      if (!h) continue;
      h.style.display = this.handlesVisible && !this.locked ? 'block' : 'none';
      h.style.left = `${x}px`;
      h.style.top = `${y}px`;
    }
    // 锁定角标：选中框左上外侧
    if (this.locked) {
      this.lockBadge.style.display = 'block';
      this.lockBadge.style.left = `${bx - 8}px`;
      this.lockBadge.style.top = `${by - 8}px`;
    } else {
      this.lockBadge.style.display = 'none';
    }
  }

  private extraBoxes: HTMLDivElement[] = [];
  setSelectedMany(boxes: OverlayBox[]): void {
    for (const b of this.extraBoxes) b.remove();
    this.extraBoxes = [];
    const origin = this.root.getBoundingClientRect();
    for (let i = 1; i < boxes.length; i += 1) {
      const box = boxes[i]!;
      const div = document.createElement('div');
      div.className = 'ep-selected-box-multi';
      div.style.cssText = 'position:absolute;border:2px solid rgba(230,81,0,0.95);box-sizing:border-box;pointer-events:none;z-index:20;';
      div.style.left = (box.left - origin.left) + 'px';
      div.style.top = (box.top - origin.top) + 'px';
      div.style.width = box.width + 'px';
      div.style.height = box.height + 'px';
      this.root.appendChild(div);
      this.extraBoxes.push(div);
    }
  }
  /** 不可缩放元素时隐藏手柄但保留选中框。 */
  setHandlesVisible(v: boolean): void {
    this.handlesVisible = v;
    for (const h of this.handles.values()) {
      if (!v) h.style.display = 'none';
    }
  }

  /** 锁定角标（外壳 ep- 节点）。 */
  setLocked(v: boolean): void {
    this.locked = v;
  }

  onHandleStart(cb: (dir: ResizeDirection, e: PointerEvent) => void): void {
    this.handleStart = cb;
  }

  private apply(boxEl: HTMLDivElement, box: OverlayBox | null): void {
    if (!box) {
      boxEl.style.display = 'none';
      return;
    }
    // outer viewport 坐标 → 相对覆盖层根的坐标
    const origin = this.root.getBoundingClientRect();
    boxEl.style.display = 'block';
    boxEl.style.left = `${box.left - origin.left}px`;
    boxEl.style.top = `${box.top - origin.top}px`;
    boxEl.style.width = `${box.width}px`;
    boxEl.style.height = `${box.height}px`;
  }
}
