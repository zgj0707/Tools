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
    el.className = 'ep-context-menu';
    el.style.cssText = 'position:fixed;min-width:160px;background:#fff;border:1px solid #ccc;box-shadow:2px 2px 8px rgba(0,0,0,0.2);z-index:9999;padding:4px 0;font-size:13px;';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ep-menu-item';
      row.textContent = item.label;
      row.style.cssText = `padding:6px 12px;cursor:${item.enabled ? 'pointer' : 'default'};color:${item.enabled ? '#222' : '#aaa'};`;
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
