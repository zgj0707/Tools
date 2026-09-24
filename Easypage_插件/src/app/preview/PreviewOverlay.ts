// 预览全屏覆盖层（批次 1 · R1）。
//
// 【为什么必须重做】
// 改造前的预览是「与画布互斥的入流块」：`.ep-preview-host` 被 append 到 #ep-app 根、
// 排在 `.ep-main` 之后，而 `.ep-main{flex:1 1 auto}` 会撑满视高 ⇒ 600px 高的预览帧
// 从 y=900 起渲染，**可见高度恒为 0**。点「预览」= 画布隐去 + 预览在屏外 = 一整屏空白。
// 叠加一条死 CSS：`.ep-preview-host` 在 app.css 有样式，但 App.ts 建那个 div 时
// 从未赋 className，规则从未生效。
//
// 【现在的位置策略】
// 覆盖层从**顶栏下方**开始（inset: var(--ep-topbar-h) 0 0 0），顶栏保持可见可点。
// 这不是偷懒：顶栏的「预览」按钮本身就是开关，preview.spec 用同一个按钮开与关；
// 若覆盖层盖住顶栏，第二次点击会因「元素被遮挡」而失败。与 .ep-import-overlay 同构。
//
// 【设备档位的意义】
// 被编辑页面多为落地页/活动页，需要确认在窄屏下的表现。档位只改预览帧宽度，
// 不改沙箱策略（`sandbox="allow-scripts"` 逐字不变，见 IFramePreviewSandbox）。

import { t } from '../i18n/zh-CN';
import { icon, srOnly } from '../ui/icons';

export type DeviceKey = 'phone' | 'tablet' | 'desktop' | 'full';

/** 档位 → 预览帧宽度。'full' 走 100%（跟随可用宽度）。 */
const DEVICE_WIDTH: Record<DeviceKey, string> = {
  phone: '375px',
  tablet: '768px',
  desktop: '1280px',
  full: '100%',
};

const DEVICE_ORDER: DeviceKey[] = ['phone', 'tablet', 'desktop', 'full'];

const DEVICE_ICON = {
  phone: 'phone',
  tablet: 'tablet',
  desktop: 'desktop',
  full: 'fullWidth',
} as const;

export interface PreviewOverlayDeps {
  /** 关闭（已由本类处理界面，回调用于让 App 走完销毁与恢复选中）。 */
  onClose: () => void;
  /** 覆盖层内点「导出」。 */
  onExport: () => void;
}

export class PreviewOverlay {
  /** 覆盖层根节点（#ep-preview-overlay）。 */
  readonly el: HTMLElement;
  /** 预览帧的宿主容器（缩放/居中由 CSS 负责）。 */
  readonly stage: HTMLElement;

  private readonly deps: PreviewOverlayDeps;
  private device: DeviceKey = 'full';
  private buttons = new Map<DeviceKey, HTMLButtonElement>();
  private open_ = false;

  constructor(deps: PreviewOverlayDeps) {
    this.deps = deps;

    this.el = document.createElement('div');
    this.el.id = 'ep-preview-overlay';
    this.el.className = 'ep-preview-overlay';
    this.el.dataset.open = 'false';

    const bar = document.createElement('div');
    bar.className = 'ep-preview__bar';

    // 标题是纯文本节点，不是按钮 —— 顶栏的「预览」按钮已占用该可访问名，
    // 这里再出现一个含「预览」的按钮会让 getByRole 命中两个元素。
    const title = document.createElement('div');
    title.className = 'ep-preview__title';
    title.textContent = t('preview.title');

    const devices = document.createElement('div');
    devices.className = 'ep-preview__devices';
    for (const key of DEVICE_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ep-btn ep-btn--icon ep-btn--sm';
      b.dataset.device = key;
      b.title = t(`preview.device.${key}` as Parameters<typeof t>[0]);
      b.appendChild(icon(DEVICE_ICON[key], 14));
      b.appendChild(srOnly(t(`preview.device.${key}` as Parameters<typeof t>[0])));
      b.addEventListener('click', () => this.setDevice(key));
      devices.appendChild(b);
      this.buttons.set(key, b);
    }

    const actions = document.createElement('div');
    actions.className = 'ep-preview__actions';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'ep-btn ep-btn--icon ep-btn--sm';
    exportBtn.title = t('preview.exportHint');
    exportBtn.appendChild(icon('download', 14));
    // 刻意只叫「导出」而非「导出 HTML」：后者是顶栏按钮的可访问名，
    // getByRole 子串匹配下会造成两个元素同名。
    exportBtn.appendChild(srOnly(t('preview.export')));
    exportBtn.addEventListener('click', () => this.deps.onExport());

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ep-btn ep-btn--icon ep-btn--sm';
    closeBtn.title = t('preview.closeHint');
    closeBtn.appendChild(icon('close', 14));
    closeBtn.appendChild(srOnly(t('preview.close')));
    closeBtn.addEventListener('click', () => this.deps.onClose());

    actions.append(exportBtn, closeBtn);

    bar.append(title, devices, actions);

    this.stage = document.createElement('div');
    this.stage.id = 'ep-preview-stage';
    this.stage.className = 'ep-preview__stage';

    this.el.append(bar, this.stage);
    this.syncDevice();
  }

  isOpen(): boolean {
    return this.open_;
  }

  get deviceKey(): DeviceKey {
    return this.device;
  }

  /** 当前档位对应的预览帧宽度（CSS 长度字符串）。 */
  get deviceWidth(): string {
    return DEVICE_WIDTH[this.device];
  }

  open(): void {
    this.open_ = true;
    this.el.dataset.open = 'true';
  }

  close(): void {
    this.open_ = false;
    this.el.dataset.open = 'false';
    this.stage.textContent = '';
  }

  setDevice(key: DeviceKey): void {
    if (this.device === key) return;
    this.device = key;
    this.syncDevice();
  }

  /**
   * 档位同步。宽度通过 CSS 变量下发到舞台，由 `#ep-preview-frame{width:var(--ep-preview-w)}`
   * 消费 —— 这样设备切换是纯视觉层的事，不需要给 PreviewSandbox 端口加方法，
   * 也不会与适配器写的内联尺寸打架（内联会盖住 CSS）。
   */
  private syncDevice(): void {
    this.stage.style.setProperty('--ep-preview-w', DEVICE_WIDTH[this.device]);
    for (const [key, btn] of this.buttons) {
      const on = key === this.device;
      btn.classList.toggle('ep-btn--active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
}
