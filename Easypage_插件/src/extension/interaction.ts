// 编辑模式与事件仲裁（P0-3）+ 就地改字入口与快捷键（P0-4）。
//
// 这是插件形态**独有**的一块工程量：旧形态下被编辑文档躺在 `sandbox="allow-same-origin"`
// 的 iframe 里、不执行脚本，插件是那页里唯一的活动者，不存在「谁的事件」这个问题。
// 插件形态下页面本来就活着，我们和它共用同一个 document ⇒ 必须明确回答：
//   「编辑模式下，这一击到底归谁？」
// 答案：**归编辑器**。但三条边界刻意留白（见 onPointerDown / onKeyDown 的注释）。
//
// 实现方式：所有监听器挂在 `document` 的**捕获阶段**，用一个 AbortController 统一装卸。
// 为什么不挂到宿主 `#ep-root` 上：宿主是 `pointer-events:none`，它收不到页面上的事件，
// 只有工具条那种 `pointer-events:auto` 的子节点能收到 —— 挂它等于只拦住了自己。

import type { EpHost } from './host';
import { isEditorOwned, resolvePickTarget } from './pick';
import type { PickOverlay } from './ui/overlay';
import type { ToggleFormat } from './format';

/** 相邻两次左键落点在这个时间内、且是同一元素 ⇒ 视为双击，进入就地改字。 */
const DOUBLE_CLICK_MS = 400;

export interface EditorHandlers {
  /** 单击选中（已归一；null 表示点在不可选的位置）。 */
  onPick(el: Element | null): void;
  /** 双击：请求在元素上就地改字。 */
  onActivate(el: Element): void;
  /** 每次左键按下前调用 —— 用来先收尾正在进行的就地编辑。 */
  onBeforePick(): void;
  /**
   * 正在就地改字的元素（null = 没有）。
   *
   * 🔴 这个 getter 是本层**放行**逻辑的依据，不是可有可无的状态查询：
   * 就地改字时若继续 preventDefault 指针事件，用户就**无法用鼠标在 contenteditable 里
   * 拖选文字** —— 而选区正是「只加粗这一个词」的前提。缺了它，格式按钮就只剩下
   * 「整段加粗」一种用法。
   */
  getEditingEl(): Element | null;
  onUndo(): void;
  onRedo(): void;
  onToggleFormat(format: ToggleFormat): void;
}

export interface InteractiveEditor {
  enable(): void;
  disable(): void;
  getSelected(): Element | null;
}

export function createEditor(host: EpHost, overlay: PickOverlay, handlers: EditorHandlers): InteractiveEditor {
  let controller: AbortController | null = null;
  let rafId = 0;
  let pending: (() => void) | null = null;
  let lastPick: { el: Element | null; t: number } = { el: null, t: 0 };

  /**
   * 合并同一帧里的多次触发（mousemove 一秒能来上百次，每次都算几何是白烧 CPU）。
   *
   * 🔴 必须是「后到覆盖先到」而不是「首个生效」：同一帧里常常成对出现
   * `mouseleave`（清空 hover）与紧随其后的 `mousemove`（设置新 hover）——
   * 用户从工具条上移开鼠标再移进页面时每帧都会这样。若写成「首个生效」，
   * 清空会赢，hover 高亮就再也不出现了，而点击选中一切正常（它不走这里）——
   * 表现为「指着元素没有提示，但点下去又选得中」，极难归因。
   */
  function schedule(fn: () => void): void {
    pending = fn;
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const run = pending;
      pending = null;
      run?.();
    });
  }

  /** 事件是否该由编辑器接管。 */
  function shouldTakeOver(e: Event): boolean {
    if (isEditorOwned(e, host.element)) return false; // 工具条自己的交互
    return true;
  }

  /** 事件是否发生在「正在就地改字的那个元素」内部 —— 是则一律放行给 contenteditable。 */
  function isInsideEditing(e: Event): boolean {
    const editingEl = handlers.getEditingEl();
    if (!editingEl) return false;
    const target = e.target as Node | null;
    return !!target && (target === editingEl || editingEl.contains(target));
  }

  // ── 被接管的事件 ──
  // 左键点击：选中与进入改字的入口。
  // 连带拦 `mousedown` / `click`：只拦 `pointerdown` 挡不住 click 的默认行为
  // （链接跳转、表单提交、label 激活），页面照样会跳走。
  function onPointerDown(e: PointerEvent): void {
    // 只接管左键。右键菜单与中键（新标签打开）保持页面原生 ——
    // 编辑内容不需要牺牲浏览器的通用能力。
    if (e.button !== 0) return;
    if (!shouldTakeOver(e)) return;
    // 就地改字中、且点在那个元素内部 ⇒ 完全放行：光标定位与拖选归 contenteditable。
    if (isInsideEditing(e)) return;
    e.preventDefault();
    e.stopPropagation();

    // 先收尾上一次的就地编辑：本层 preventDefault 过 mousedown ⇒ contenteditable
    // 拿不到 blur，若不等这里提交，编辑态会赖着不走、下一次编辑叠在上一个元素上。
    handlers.onBeforePick();

    const picked = resolvePickTarget(e.target as Element | null, host.element);
    overlay.setSelected(picked);
    handlers.onPick(picked);

    // 双击检测自己做，不用原生 `dblclick`：我们已经 preventDefault 了 click，
    // dblclick 的派生行为在 Chromium 上不再可靠。
    const now = performance.now();
    if (picked && picked === lastPick.el && now - lastPick.t <= DOUBLE_CLICK_MS) {
      lastPick = { el: null, t: 0 }; // 复位：避免三击继续触发
      handlers.onActivate(picked);
      return;
    }
    lastPick = { el: picked, t: now };
  }

  function onClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (!shouldTakeOver(e)) return;
    if (isInsideEditing(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    if (!shouldTakeOver(e)) return;
    if (isInsideEditing(e)) return;
    // 不 preventDefault，交给 pointerdown 统一处理 —— 二者同时 preventDefault
    // 会让某些页面的选择态判断异常；这里只为堵住 click 链路。
    e.stopPropagation();
  }

  /** 悬停高亮：告诉用户「点下去会选中谁」。必须与 pointerdown 用同一个归一函数。 */
  function onMouseMove(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (isEditorOwned(e, host.element) || isInsideEditing(e)) {
      // 指针在工具条上、或在正在改字的元素内部时都不出框 ——
      // 否则框会跟着光标在正在编辑的段落里来回抖。
      schedule(() => overlay.setHover(null));
      return;
    }
    schedule(() => overlay.setHover(resolvePickTarget(target, host.element)));
  }

  function onMouseLeave(): void {
    schedule(() => overlay.setHover(null));
  }

  // ── 不接管、但要响应的事件 ──
  // 滚动：几何全变了。用捕获阶段是因为 `scroll` 不冒泡，只有捕获能听见
  // 内部滚动容器的事件；`passive: true` 明示我们不会阻断滚动。
  function onScroll(): void {
    schedule(() => overlay.refresh());
  }

  // 尺寸变化：视口变了，宿主的固定层跟着变，元素的视口坐标也变。
  function onResize(): void {
    schedule(() => overlay.refresh());
  }

  /**
   * 键盘：只认 Esc 与带修饰键的快捷键。
   *
   * 其余按键一概不碰 —— 编辑模式下用户仍然要用方向键、PageUp/PageDown 翻页，
   * 抢过来只会让人以为页面坏了。
   *
   * ⚠️ 就地改字进行中时 **Esc 必须让给就地编辑器**（它的语义是「取消这次修改」，
   * 而不是「取消选中」）；但 Ctrl+B/I/U/Z 仍由我们处理 —— 否则浏览器原生的
   * `execCommand('bold')` 会插 `<b>` 标签，与工具条插 `<strong>` 的做法分叉，
   * 同一份文档里出现两套加粗标记。
   */
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (handlers.getEditingEl()) return;
      overlay.setSelected(null);
      handlers.onPick(null);
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const take = (): void => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (key === 'z') {
      take();
      if (e.shiftKey) handlers.onRedo();
      else handlers.onUndo();
      return;
    }
    if (key === 'y') {
      take();
      handlers.onRedo();
      return;
    }
    if (key === 'b' || key === 'i' || key === 'u') {
      take();
      handlers.onToggleFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
    }
  }

  function attach(): void {
    if (controller) return;
    controller = new AbortController();
    const { signal } = controller;

    document.addEventListener('pointerdown', onPointerDown, { capture: true, signal });
    document.addEventListener('mousedown', onMouseDown, { capture: true, signal });
    document.addEventListener('click', onClick, { capture: true, signal });
    document.addEventListener('mousemove', onMouseMove, { capture: true, signal });
    document.addEventListener('mouseleave', onMouseLeave, { capture: true, signal });
    document.addEventListener('scroll', onScroll, { capture: true, passive: true, signal });
    document.addEventListener('keydown', onKeyDown, { capture: true, signal });
    window.addEventListener('resize', onResize, { signal });
  }

  function detach(): void {
    controller?.abort();
    controller = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    // 丢掉排队中的那一帧：退出编辑模式后不该再有一次迟到的 setHover 落到覆盖层上。
    pending = null;
    lastPick = { el: null, t: 0 };
  }

  return {
    enable(): void {
      attach();
    },
    disable(): void {
      detach();
      overlay.setHover(null);
      overlay.setSelected(null);
    },
    getSelected: () => overlay.getSelected(),
  };
}
