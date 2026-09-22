// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildList, canUnwrapList, canWrapList, unwrapList } from '../../src/core/elements/list';

describe('buildList', () => {
  it('P → ul>li 且子节点移动（原块无子节点）', () => {
    const doc = document.implementation.createHTMLDocument();
    const p = doc.createElement('p');
    p.textContent = 'hello';
    const list = buildList(doc, p, 'ul');
    expect(list.tagName).toBe('UL');
    expect(list.firstElementChild?.tagName).toBe('LI');
    expect(list.textContent).toBe('hello');
    expect(p.childNodes.length).toBe(0);
  });
  it('ol 同理，内联子元素保留', () => {
    const doc = document.implementation.createHTMLDocument();
    const p = doc.createElement('p');
    const strong = doc.createElement('strong');
    strong.textContent = 'x';
    p.append('a', strong, 'b');
    const list = buildList(doc, p, 'ol');
    expect(list.tagName).toBe('OL');
    expect(list.textContent).toBe('axb');
    expect(list.querySelector('strong')).not.toBeNull();
  });
});

describe('unwrapList', () => {
  it('两 li → 两个 p 且文本保留', () => {
    const doc = document.implementation.createHTMLDocument();
    const ul = doc.createElement('ul');
    const li1 = doc.createElement('li'); li1.textContent = 'a';
    const li2 = doc.createElement('li'); li2.textContent = 'b';
    ul.append(li1, li2);
    const ps = unwrapList(doc, ul);
    expect(ps.length).toBe(2);
    expect(ps[0]?.tagName).toBe('P');
    expect(ps[0]?.textContent).toBe('a');
    expect(ps[1]?.textContent).toBe('b');
  });
});

describe('canWrapList / canUnwrapList', () => {
  it('P 可包裹，DIV 不可', () => {
    const doc = document.implementation.createHTMLDocument();
    expect(canWrapList(doc.createElement('p'))).toBe(true);
    expect(canWrapList(doc.createElement('div'))).toBe(false);
  });
  it('含块级子元素不可包裹', () => {
    const doc = document.implementation.createHTMLDocument();
    const p = doc.createElement('p');
    p.appendChild(doc.createElement('div'));
    expect(canWrapList(p)).toBe(false);
  });
  it('table 内不可', () => {
    const doc = document.implementation.createHTMLDocument();
    const table = doc.createElement('table');
    const p = doc.createElement('p');
    table.appendChild(p);
    expect(canWrapList(p)).toBe(false);
  });
  it('单层 ul 可取消，嵌套不可', () => {
    const doc = document.implementation.createHTMLDocument();
    const ul = doc.createElement('ul');
    ul.appendChild(doc.createElement('li'));
    expect(canUnwrapList(ul)).toBe(true);
    const nested = doc.createElement('ul');
    const li = doc.createElement('li');
    li.appendChild(doc.createElement('ul'));
    nested.appendChild(li);
    expect(canUnwrapList(nested)).toBe(false);
  });
});

import { UnwrapListCommand } from '../../src/core/commands/commands';

describe('UnwrapListCommand 位置还原', () => {
  it('execute→undo 后 list 回到原 index、兄弟不变', () => {
    const doc = document.implementation.createHTMLDocument();
    const a = doc.createElement('p'); a.textContent = 'A';
    const ul = doc.createElement('ul');
    const li = doc.createElement('li'); li.textContent = 'B';
    ul.appendChild(li);
    const c = doc.createElement('p'); c.textContent = 'C';
    doc.body.append(a, ul, c);

    const cmd = new UnwrapListCommand(ul);
    cmd.execute();
    expect(doc.body.children[0]).toBe(a);
    expect(doc.body.children[1]?.textContent).toBe('B');
    expect(doc.body.children[2]).toBe(c);

    cmd.undo();
    expect(doc.body.children[0]).toBe(a);
    expect(doc.body.children[1]).toBe(ul);
    expect(doc.body.children[2]).toBe(c);

    cmd.execute();
    expect(doc.body.children[0]).toBe(a);
    expect(doc.body.children[1]?.textContent).toBe('B');
    expect(doc.body.children[2]).toBe(c);
  });
});
