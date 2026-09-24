// 命中归一（P0-2）：把「指针指到的那个元素」翻译成「编辑器真正要选中的那个元素」。
//
// 为什么需要这一层，而不是直接选 `event.target`：
//   用户点的是「一段话里的某个词」，浏览器给的 target 却是那个词的 `<strong>`。
//   若照单全收就选中了一个行内元素 —— 改字号/改颜色/加粗都会作用在半个句子上，
//   而用户的意图是「改这一段」。Word 的心智模型是「光标在文字里，样式作用于段落」，
//   插件要贴近这个模型，就得有一层归一。
//
// 🔴 两个方向的判断必须是同一个函数：hover 高亮用 `resolvePickTarget` 决定
//   「谁将被选中」，点击选中也用它。若两者算法不同，就会出现「我指着 A，选中了 B」——
//   这是所有编辑器里最伤信任的一类 bug，且极难在断言里发现（每边单独看都对）。
//
// ⚠️ SVG 是刻意的例外：SVG 里 `<rect>` 的 `display` 计算值是 `inline`，若一并归一，
//   点矩形会一路向上选到整个 `<svg>` —— 那 P1「拖节点、改连线端点」就无从谈起。
//   SVG 内的语义单位本就是图形本身，所以**直接返回命中的那个图形元素**，不做归一。

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 命中的元素是否定义了「自己的盒子」（而非纯粹的行内文字容器）。 */
export function hasOwnBox(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  // 拿不到 view（例如已脱离文档的节点）时按「有盒子」处理：
  // 宁可停在这一层，也不要因为读不到样式而一路归一到 body 去。
  if (!view) return true;
  const display = view.getComputedStyle(el).display;
  // `contents` 的元素不生成盒子，点它等于点它的父级 ⇒ 继续向上。
  return display !== 'inline' && display !== 'contents';
}

export function isSvgElement(el: Element): boolean {
  return el.namespaceURI === SVG_NS;
}

/**
 * 把命中元素归一到编辑器要选中的元素；没有可选的则返回 `null`。
 *
 * 规则（自内向外，首个命中即返回）：
 *   1. 编辑器自己的节点 → `null`（不属于被编辑内容）
 *   2. `html` / `body` → `null`（选整页没有意义，框住全屏也提示不了任何信息）
 *   3. SVG 内 → 命中元素本身（见文件头说明）
 *   4. 第一个「有自己盒子」的元素 → 它就是归一终点
 *   5. 一路都是行内元素 → 走到 `body` 时按规则 2 返回 `null`
 *
 * 第 5 条是刻意的：`<body><span>x</span></body>` 这种「块级全靠默认」的文档里，
 * 选中那个散装 `<span>` 会让后续所有操作都作用在半个页面上，不如不选。
 */
export function resolvePickTarget(target: Element | null, host: Element): Element | null {
  let el: Element | null = target;

  while (el) {
    // 编辑器自己（工具条、覆盖层）—— 看见即停。宿主内部的节点其 parentElement
    // 最终为 null（ShadowRoot 没有 parentElement），所以这一支也是循环的兜底出口。
    if (el === host) return null;

    const doc = el.ownerDocument;
    if (el === doc.documentElement || el === doc.body) return null;

    if (isSvgElement(el)) return el;
    if (hasOwnBox(el)) return el;

    el = el.parentElement;
  }

  return null;
}

/**
 * 事件目标是否落在编辑器自己的 UI 里。
 *
 * 用 `composedPath()` 而不是 `closest('#ep-root')`：宿主 `#ep-root` 在 light DOM，
 * 但工具条在它的 shadow 内部 —— 事件从 shadow 冒出来时，`composedPath()` 才带着
 * shadow 内部的节点，`closest` 则只看得见宿主那一层，无法区分「点在工具条上」
 * 和「点在宿主透明层的空白处」。
 */
export function isEditorOwned(event: Event, host: Element): boolean {
  const path = event.composedPath();
  return path.includes(host);
}
