// 插件宿主（P0-1）：把编辑器 UI 挂到「用户正在看的那个页面」上，并保证可完全清除。
//
// 与旧的 `app/canvas/CanvasHost.ts` 的根本差别：
//   · **没有 iframe**。被编辑的就是目标 document 本身，不存在第二个文档要同步。
//   · 编辑器 UI 全部进 Shadow DOM。目标页面有自己的 CSS，`.ep-*` 类名在那里没有任何
//     优先级保障；进 shadow 是从结构上解决，而不是靠堆选择器权重。
//   · 宿主元素自身的盒模型由**内联样式**钉死 —— 这是唯一无法被 shadow 保护的地方
//     （页面若用 `!important` 仍可能干扰，属已知边界，见 `07` §7）。
//   · 坐标基准 = 视口。宿主 `position:fixed; inset:0` 提供恒等于视口的坐标系，
//     因此页面滚动、变长都不需要重算宿主本身；「覆盖层跟随滚动」是 P0-2 的事。
//
// 清除契约（`07` · C4）：`destroy()` 之后页面里不得残留 `#ep-root` / `data-ep-*` / `.ep-*`。
// 本模块只创建 `#ep-root` 一个节点，其余全在其 shadow 内部 ⇒ 移除该节点即彻底清除。

import toolbarCss from './style/toolbar.css?inline';
import { EPX } from './anchors';

/** 保留给既有 CSS 作用域检查；运行时工具条样式直接定义在 `:host`。 */
export function scopeCssToShadow(css: string): string {
  return css.replace(/^([ \t]*):root([ \t]*[,{])/gm, '$1:host$2');
}

export interface EpHost {
  /** light DOM 里的宿主节点，也是 `destroy()` 的移除对象。 */
  readonly element: HTMLElement;
  readonly shadow: ShadowRoot;
  /** Shadow 内的 UI 容器（工具条与后续面板的挂载点）。 */
  readonly ui: HTMLElement;
  destroy(): void;
}

/** 宿主内联样式：定住坐标系，并声明「本层不吃指针事件」。 */
const HOST_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:2147483000',
  // 非编辑模式下页面必须能被正常点击 ⇒ 命中测试要穿过本层。
  // 需要接收事件的子元素（工具条）在 toolbar.css 里标成 pointer-events:auto。
  'pointer-events:none',
  'margin:0',
  'padding:0',
  'border:0',
  'background:none',
].join(';');

export function mountHost(doc: Document = document): EpHost {
  const element = doc.createElement('div');
  element.id = EPX.ROOT;
  element.setAttribute('data-ep-root', '');
  element.setAttribute(EPX.HOST_MARKER_ATTR, '1');
  element.style.cssText = HOST_STYLE;

  const shadow = element.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.setAttribute('data-ep-style', '');
  style.textContent = toolbarCss;
  shadow.appendChild(style);

  const ui = doc.createElement('div');
  ui.id = EPX.UI;
  ui.setAttribute('data-ep-ui', '');
  shadow.appendChild(ui);

  // 挂 documentElement 而非 body：页面脚本（框架、模板）可能整体替换 body，
  // 挂在 html 下可躲开这类替换。宿主是固定层、不参与文档流，放这里不影响布局。
  doc.documentElement.appendChild(element);

  return {
    element,
    shadow,
    ui,
    destroy(): void {
      element.remove();
    },
  };
}
