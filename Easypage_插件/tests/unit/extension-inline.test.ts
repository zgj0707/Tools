// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isTextEditable } from '../../src/extension/inline';

/**
 * 🔴 这组单测有环境前提，而且前提**只成立一半**，必须先把边界钉住：
 *
 * `isTextEditable` 是「结构性判定」，它靠 `getComputedStyle(child).display` 判断
 * 子元素有没有自己的盒子。但 happy-dom 的 UA 样式表**只实现了子集**：
 *   - 有值：`div/section/p/h1/ul/ol/li/table/tr/main/...` → `block` / `list-item` / `table` …
 *   - **空字符串**：`span/a/strong/em/code/td/th/tbody/caption/img/...`
 * 真实浏览器里 `display` 永远算得出（拿不到就退回初始值 `inline`），所以这是**测试环境的
 * 能力缺口，不是逻辑缺口** —— 绝不为迁就它去改产品代码（那会在 `tbody` 那条上引入假象：
 * 真值 `table-row-group` 是「有盒子」，happy-dom 给空串）。
 *
 * 两个后果，都已在本文件里显式处置：
 *   ① 凡是「子元素靠**默认**行内样式」的用例，happy-dom 验不了 ⇒ 夹具改成**显式**写
 *      `style="display:inline"`（两边引擎都会照办），并在用例名里写明。
 *   ② 真断言权交给真浏览器的「容器矩阵」：`qa/probes/extension-p0-4.mjs`，
 *      用夹具里真实的 `#inner`(div) / `#bigbox`(section) / `#outer`(含块子元素) 跑。
 *
 * 下面第一组不是「前提自检」而是**能力快照**：它把 happy-dom 当前的能力钉成断言。
 * 哪天它把 UA 样式表补全了，这组会先变红 —— 那时就该把 ① 那些显式样式拆掉、把断言收紧。
 */

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

/** 把一个标签显式声明成 `display` 指定的值 —— 判定看的是**子元素**，所以样式要写在子元素上。 */
const explicit = (display: string, tag: string, text: string) =>
  `<${tag} style="display:${display}">${text}</${tag}>`;

describe('环境能力快照 · happy-dom 的 UA 样式表', () => {
  it('块级标签：算得出 display', () => {
    expect(getComputedStyle(mount('<div>x</div>')).display).toBe('block');
    expect(getComputedStyle(mount('<section>x</section>')).display).toBe('block');
    expect(getComputedStyle(mount('<p>x</p>')).display).toBe('block');
  });

  it('🔴 行内标签：算不出 display（返回空串）—— 这就是那些用例必须显式写样式的原因', () => {
    expect(getComputedStyle(mount('<span>x</span>')).display).toBe('');
    expect(getComputedStyle(mount('<strong>x</strong>')).display).toBe('');
    expect(getComputedStyle(mount('<td>x</td>')).display).toBe('');
  });

  it('显式声明的 display 是认的（所以显式夹具在两个引擎下语义一致）', () => {
    expect(getComputedStyle(mount('<span style="display:inline">x</span>')).display).toBe('inline');
    expect(getComputedStyle(mount('<span style="display:block">x</span>')).display).toBe('block');
  });
});

describe('isTextEditable · 结构性判定（2026-09-23 起）', () => {
  it('🔴 只装文字的 <div> / <section> / <article> ⇒ 可改（这正是用户报的那个缺口）', () => {
    expect(isTextEditable(mount('<div>只装文字</div>'))).toBe(true);
    expect(isTextEditable(mount('<section>只装文字</section>'))).toBe(true);
    expect(isTextEditable(mount('<article>只装文字</article>'))).toBe(true);
  });

  it('🔴 含块级子元素的容器 ⇒ 不可改（让整块 contenteditable 会把块级结构搅乱）', () => {
    expect(isTextEditable(mount('<div>文字<div>子块</div></div>'))).toBe(false);
    expect(isTextEditable(mount('<section><p>子段</p></section>'))).toBe(false);
    // 显式写法：把「display 决定有无自己的盒子」这条规则单独钉住，不依赖环境默认值
    expect(isTextEditable(mount(`<div>文字${explicit('block', 'span', '子块')}</div>`))).toBe(false);
  });

  it('只装行内子元素 ⇒ 可改（行内不生成独立盒子，它仍是一段文字）', () => {
    // ⚠️ 夹具显式写 display:inline —— 见文件头「能力快照」第 ① 条
    expect(isTextEditable(mount(`<div>${explicit('inline', 'span', 'a')}${explicit('inline', 'span', 'b')}</div>`))).toBe(true);
    expect(isTextEditable(mount(`<p>${explicit('inline', 'strong', '加粗')}普通</p>`))).toBe(true);
  });

  it('段落类标签照旧可改（快路径）', () => {
    for (const tag of ['p', 'h1', 'h2', 'h3', 'span', 'a', 'label', 'td', 'th', 'blockquote', 'figcaption', 'code']) {
      expect(isTextEditable(mount(`<${tag}>文字</${tag}>`)), tag).toBe(true);
    }
  });

  it('嵌套列表的 <li> 不可改（它不是一段文字，下面还有块）', () => {
    expect(isTextEditable(mount('<li>文字</li>'))).toBe(true);
    expect(isTextEditable(mount('<li>文字<ul><li>子项</li></ul></li>'))).toBe(false);
    expect(isTextEditable(mount('<ul><li>子项</li></ul>'))).toBe(false);
  });

  it('表格容器不可改，但单元格可改', () => {
    const table = mount('<table><tbody><tr><td>格</td></tr></tbody></table>');
    expect(isTextEditable(table)).toBe(false);
    expect(isTextEditable(table.querySelector('td')!)).toBe(true);
  });

  it('页面骨架与不可见容器不可改', () => {
    expect(isTextEditable(document.documentElement)).toBe(false);
    expect(isTextEditable(document.body)).toBe(false);
    expect(isTextEditable(mount('<main><p>a</p></main>'))).toBe(false);
  });

  it('🔴 替换元素 / 表单控件不可改 —— 必须在结构判定之前拦', () => {
    // <img> 没有子元素、<textarea> 的 textContent 是默认值，单看结构两者都会被误判成可改。
    expect(isTextEditable(mount('<img src="a.png" alt="x">'))).toBe(false);
    expect(isTextEditable(mount('<textarea>默认值</textarea>'))).toBe(false);
    expect(isTextEditable(mount('<input value="x">'))).toBe(false);
    expect(isTextEditable(mount('<select><option>x</option></select>'))).toBe(false);
    expect(isTextEditable(mount('<hr>'))).toBe(false);
  });

  it('空的 <div> 不可改（没字可改；避免双击空白处就进编辑态）', () => {
    expect(isTextEditable(mount('<div></div>'))).toBe(false);
    expect(isTextEditable(mount('<div>   </div>'))).toBe(false);
  });

  it('SVG 元素不可改（图形编辑走 P1 那条线）', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    expect(isTextEditable(svg)).toBe(false);
  });
});
