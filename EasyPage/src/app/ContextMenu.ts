// 右键上下文菜单（T114）：外壳 ep- 节点，不进入被编辑 doc。
// 菜单项按上下文启用/禁用，点外部/Esc 关闭。

export interface ContextMenuItem {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ContextMenuHooks {
  onPick: (id: string) => void;
}

export class ContextMenu {
  private root: HTMLElement;
  private el: HTMLDivElement | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = host;
  }

  show(x: number, y: number, items: ContextMenuItem[], hooks: ContextMenuHooks): void {
    this.hide();
    const el = document.createElement('div');
    // 视觉（定位方式 / 层级 / 最小宽 / 内边距 / 边框 / 圆角 / 底色 / 阴影）全部由
    // app.css 的 .ep-context-menu 承担，此处只保留 left/top 这两个坐标计算值。
    el.className = 'ep-context-menu';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ep-menu-item';
      row.textContent = item.label;
      // 视觉（内边距 / 字号 / 配色 / 光标）由 .ep-menu-item 与
      // .ep-menu-item[data-disabled='true'] 承担，这里只标注启用态供 CSS 选择。
      row.dataset.disabled = item.enabled ? 'false' : 'true';
      if (item.enabled) {
        row.addEventListener('click', () => {
          hooks.onPick(item.id);
          this.hide();
        });
      }
      el.appendChild(row);
    }
    el.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
    this.root.appendChild(el);
    this.el = el;

    const onDown = (ev: MouseEvent) => {
      if (!el.contains(ev.target as Node)) this.hide();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') this.hide();
    };
    this.closeHandler = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }

  hide(): void {
    if (this.el) this.el.remove();
    this.el = null;
    if (this.closeHandler) {
      this.closeHandler();
      this.closeHandler = null;
    }
  }
}
