// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isEditorOwned, isSvgElement, resolvePickTarget } from '../../src/extension/pick';

/**
 * 归一规则是「点哪里 ⇒ 选中什么」的唯一裁决者，hover 与点击共用它。
 * 这条规则错一点，用户就会遇到「我指着 A，选中了 B」——
 * 每边单独看都对、只有对照才发现的 bug，所以逐条钉死在这里。
 *
 * ⚠️ 测试里**显式设置 `display`**，不用 UA 默认样式：happy-dom 的默认样式表
 * 保真度不保证，靠它的话这里测的就成了「测试环境的 CSS 引擎」，而不是我们的逻辑。
 */

function tree(html: string): { host: HTMLElement } {
  document.body.innerHTML = html;
  const host = document.createElement('div');
  host.id = 'ep-root';
  document.body.appendChild(host);
  return { host };
}

function withDisplay<T extends HTMLElement>(el: T, display: string): T {
  el.style.display = display;
  return el;
}

function id<T extends HTMLElement = HTMLElement>(value: string): T {
  const el = document.getElementById(value);
  if (!el) throw new Error(`fixture 缺少 #${value}`);
  return el as T;
}

describe('resolvePickTarget · 文档内容', () => {
  it('点段落里的 <strong> ⇒ 选中整个 <p>（Word 心智模型：样式作用于段落）', () => {
    const { host } = tree('<p id="p"><strong id="s">重点</strong></p>');
    withDisplay(id('p'), 'block');
    withDisplay(id('s'), 'inline');
    expect(resolvePickTarget(id('s'), host)).toBe(id('p'));
  });

  it('点行内 <a> ⇒ 归一到块级祖先', () => {
    const { host } = tree('<div id="d"><p id="p"><a id="a" href="#">链接</a></p></div>');
    withDisplay(id('d'), 'block');
    withDisplay(id('p'), 'block');
    withDisplay(id('a'), 'inline');
    expect(resolvePickTarget(id('a'), host)).toBe(id('p'));
  });

  it('命中的元素本身有盒子 ⇒ 就是它，不再向上扩大', () => {
    const { host } = tree('<div id="outer"><div id="inner">内容</div></div>');
    withDisplay(id('outer'), 'block');
    withDisplay(id('inner'), 'block');
    expect(resolvePickTarget(id('inner'), host)).toBe(id('inner'));
  });

  it('表格单元格停在同一格（display:table-cell 有自己的盒子）', () => {
    const { host } = tree('<table><tr><td id="td"><span id="sp">12,480</span></td></tr></table>');
    withDisplay(id('td'), 'table-cell');
    withDisplay(id('sp'), 'inline');
    expect(resolvePickTarget(id('sp'), host)).toBe(id('td'));
  });

  it('列表项停在 <li>，不会吞掉整个 <ul>', () => {
    const { host } = tree('<ul><li id="li"><em id="em">条目</em></li></ul>');
    withDisplay(id('li'), 'list-item');
    withDisplay(id('em'), 'inline');
    expect(resolvePickTarget(id('em'), host)).toBe(id('li'));
  });

  it('display:contents 的元素不生成盒子 ⇒ 继续向上', () => {
    const { host } = tree('<div id="d"><span id="wrap"><b id="b">x</b></span></div>');
    withDisplay(id('d'), 'block');
    withDisplay(id('wrap'), 'contents');
    withDisplay(id('b'), 'inline');
    expect(resolvePickTarget(id('b'), host)).toBe(id('d'));
  });

  it('inline-block 有自己的盒子 ⇒ 停住（如按钮、图片）', () => {
    const { host } = tree('<p id="p"><img id="img"></p>');
    withDisplay(id('p'), 'block');
    withDisplay(id('img'), 'inline-block');
    expect(resolvePickTarget(id('img'), host)).toBe(id('img'));
  });

  it('一路都是行内元素 ⇒ 返回 null（宁可不错选，也不选中「半个页面」）', () => {
    const { host } = tree('<span id="s">散装文字</span>');
    withDisplay(id('s'), 'inline');
    expect(resolvePickTarget(id('s'), host)).toBeNull();
  });
});

describe('resolvePickTarget · 必须拒绝的目标', () => {
  it('html / body 不可选（框住整页给不出任何信息）', () => {
    const { host } = tree('<p>内容</p>');
    expect(resolvePickTarget(document.documentElement, host)).toBeNull();
    expect(resolvePickTarget(document.body, host)).toBeNull();
  });

  it('编辑器宿主自身不可选', () => {
    const { host } = tree('<p>内容</p>');
    expect(resolvePickTarget(host, host)).toBeNull();
  });

  it('null 目标返回 null', () => {
    const { host } = tree('<p>内容</p>');
    expect(resolvePickTarget(null, host)).toBeNull();
  });
});

describe('resolvePickTarget · SVG 例外', () => {
  const SVG = 'http://www.w3.org/2000/svg';

  it('点 SVG <rect> ⇒ 选中 rect 本身，不归一（否则 P1 拖节点无从谈起）', () => {
    const { host } = tree('<figure id="fig"><svg id="svg"><rect id="r"></rect></svg></figure>');
    withDisplay(id('fig'), 'block');
    const rect = document.getElementById('r')!;
    expect(resolvePickTarget(rect, host)).toBe(rect);
  });

  it('SVG <text> 同样精确命中（它的 display 计算值其实是 inline）', () => {
    const { host } = tree('<svg id="svg"><text id="t">标签</text></svg>');
    const text = document.getElementById('t')! as unknown as HTMLElement;
    text.style.display = 'inline'; // 刻意设成 inline：走 SVG 分支就必须无视它
    expect(resolvePickTarget(text, host)).toBe(text);
  });

  it('isSvgElement 只认 SVG 命名空间', () => {
    const { host } = tree('<svg id="svg"><rect id="r"></rect></svg><div id="d"></div>');
    expect(isSvgElement(document.getElementById('r')!)).toBe(true);
    expect(isSvgElement(document.getElementById('svg')!)).toBe(true);
    expect(isSvgElement(document.getElementById('d')!)).toBe(false);
    expect(isSvgElement(resolvePickTarget(id('d'), host) ?? document.body)).toBe(false);
  });

  it('用 SVG 命名空间造出来的节点也算（不依赖解析器的启发式）', () => {
    const rect = document.createElementNS(SVG, 'rect');
    expect(isSvgElement(rect)).toBe(true);
  });
});

describe('isEditorOwned', () => {
  /**
   * `composedPath()` 是判断「事件是否来自编辑器自身 UI」的唯一可靠依据：
   * 工具条位于宿主的 shadow 内部，`closest('#ep-root')` 看不见那一层。
   * 这里用鸭子类型造事件，避免依赖 happy-dom 对 Shadow DOM 事件路径的保真度 ——
   * 真实的穿透行为由 qa/probes/extension-p0-2-3.mjs 在真浏览器里验。
   */
  function fakeEvent(path: unknown[]): Event {
    return { composedPath: () => path } as unknown as Event;
  }

  it('路径含宿主 ⇒ 属于编辑器', () => {
    const { host } = tree('<p>内容</p>');
    const bar = document.createElement('div');
    host.appendChild(bar);
    expect(isEditorOwned(fakeEvent([bar, host, document.body]), host)).toBe(true);
  });

  it('路径不含宿主 ⇒ 属于页面', () => {
    const { host } = tree('<p id="p">内容</p>');
    expect(isEditorOwned(fakeEvent([id('p'), document.body]), host)).toBe(false);
  });
});
