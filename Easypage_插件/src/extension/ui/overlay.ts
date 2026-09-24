// 覆盖层（P0-2）：在用户页面上画 hover 高亮框与选中框，并跟随滚动/尺寸变化。
//
// 坐标系：宿主 `#ep-root` 是 `position:fixed; inset:0`（见 host.ts），于是它自身
// **恒等于视口**。这不只是省事 —— 页面滚动、内容变长都不会改变宿主的位置，
// 所以「跟随滚动」只需重算被标元素的 `getBoundingClientRect()`，不必补偿任何滚动量。
// （旧形态要减 iframe 偏移、乘缩放比，见 app/canvas/geom.ts 的 frameToOverlay；
//   插件形态下那些换算全部消失，这也是「没有 iframe」带来的实际收益。）
//
// 分工沿用仓库铁律：几何（left/top/width/height/display）留内联 —— 它是断言对象；
// 描边与填充交给 toolbar.css 的同名 id 规则，本模块一个色值都不写。

import { hoverFillAllowed, isDocumentRoot } from '../../app/canvas/geom';
import { EPX } from '../anchors';

export interface PickOverlay {
  readonly element: HTMLElement;
  /** 悬停高亮；传 null 或已脱离文档的元素即隐藏。 */
  setHover(el: Element | null): void;
  /** 选中框；传 null 或已脱离文档的元素即隐藏。 */
  setSelected(el: Element | null): void;
  /**
   * 正在就地改字的元素（P0-4 补的可见反馈）；传 null 即隐藏。
   *
   * 与选中框**叠加**而非互斥：改字时两层同时在场 —— 实线蓝框说「改的是这一块」，
   * 虚线框说「此刻正在改」。只留一层的话，用户无法区分「选中了」与「正在编辑」。
   */
  setEditing(el: Element | null): void;
  /** 用当前记录的元素重算几何。滚动 / resize / 元素尺寸变化后调用。 */
  refresh(): void;
  getHover(): Element | null;
  getSelected(): Element | null;
}

const BOX_STYLE = ['position:absolute', 'box-sizing:border-box', 'pointer-events:none', 'display:none'].join(
  ';',
);

function makeBox(doc: Document, id: string): HTMLDivElement {
  const box = doc.createElement('div');
  box.id = id;
  box.style.cssText = BOX_STYLE;
  return box;
}

/**
 * 宿主（= 视口）矩形。用它而不是 `window.innerWidth/innerHeight`：
 * 宿主是覆盖层的定位基准，两者必须是同一个矩形，否则描边会与元素错位。
 */
function viewportRectOf(origin: HTMLElement): DOMRect {
  return origin.getBoundingClientRect();
}

export function buildOverlay(doc: Document, origin: HTMLElement): PickOverlay {
  const root = doc.createElement('div');
  root.id = EPX.OVERLAY;

  const hoverBox = makeBox(doc, EPX.HOVER_BOX);
  const selectedBox = makeBox(doc, EPX.SELECTED_BOX);
  const editBox = makeBox(doc, EPX.EDIT_BOX);
  root.appendChild(hoverBox);
  root.appendChild(selectedBox);
  root.appendChild(editBox);

  let hoverEl: Element | null = null;
  let selectedEl: Element | null = null;
  let editingEl: Element | null = null;

  /** 元素是否还能被标注：脱离文档的节点绝不能再画框（否则框会僵在半空）。 */
  function live(el: Element | null): el is Element {
    return !!el && el.isConnected;
  }

  /**
   * 把元素的框写到盒子上。返回是否显示了。
   *
   * `fillGate` 只对 hover 生效：大容器保留半透明填充会盖住整页内容
   * （用户说的「蓝色框非常影响使用」，T123），所以按面积占比决定填充与否，
   * `data-fill` 由 toolbar.css 里的 `#ep-hover-box[data-fill='false']` 消费。
   */
  function apply(boxEl: HTMLElement, el: Element | null, fillGate: boolean): void {
    if (!live(el)) {
      boxEl.style.display = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    const originRect = viewportRectOf(origin);
    const box = {
      left: rect.left - originRect.left,
      top: rect.top - originRect.top,
      width: rect.width,
      height: rect.height,
    };

    // 零尺寸的元素（display:contents 的容器、塌陷的空盒子）画出来只是一个点，
    // 不显示比显示一个误导性的原点好。
    if (box.width <= 0 || box.height <= 0) {
      boxEl.style.display = 'none';
      return;
    }

    // 完全滚出视口时隐藏：留着框会让用户以为「还选中着这条」，而它在视野外。
    const offscreen =
      box.left + box.width <= 0 ||
      box.top + box.height <= 0 ||
      box.left >= originRect.width ||
      box.top >= originRect.height;
    if (offscreen) {
      boxEl.style.display = 'none';
      return;
    }

    boxEl.style.display = 'block';
    boxEl.style.left = `${Math.round(box.left)}px`;
    boxEl.style.top = `${Math.round(box.top)}px`;
    boxEl.style.width = `${Math.round(box.width)}px`;
    boxEl.style.height = `${Math.round(box.height)}px`;
    if (fillGate) boxEl.dataset.fill = hoverFillAllowed(box, originRect) ? 'true' : 'false';
  }

  function paint(): void {
    // 根元素（html/body）不给 hover 高亮：它的框恒等于整页，等于给整页套蓝框。
    // 与选中框重合时也不画 —— 两层描边叠在一起只是把线加粗，读不出额外信息。
    const hoverTarget = hoverEl && hoverEl !== selectedEl && !isDocumentRoot(hoverEl) ? hoverEl : null;
    apply(hoverBox, hoverTarget, true);
    apply(selectedBox, selectedEl, false);
    apply(editBox, editingEl, false);
  }

  return {
    element: root,
    setHover(el: Element | null): void {
      hoverEl = el;
      paint();
    },
    setSelected(el: Element | null): void {
      selectedEl = el;
      paint();
    },
    setEditing(el: Element | null): void {
      editingEl = el;
      paint();
    },
    refresh: paint,
    // 读的时候再过一道 `live`：页面重渲染会把选中的元素整棵换掉，
    // 此时对外必须表现为「没选中」，而不是交出一个已经不在文档里的孤儿节点。
    getHover: () => (live(hoverEl) ? hoverEl : null),
    getSelected: () => (live(selectedEl) ? selectedEl : null),
  };
}
