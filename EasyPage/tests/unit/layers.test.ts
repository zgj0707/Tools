// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { LockState } from '../../src/core/model/LockState';
import { ReorderNodeCommand, SetDisplayCommand } from '../../src/core/commands/commands';
import { collectRows } from '../../src/app/panels/layers/tree';

describe('LockState', () => {
  it('toggle/isLocked', () => {
    const ls = new LockState();
    const el = document.createElement('div');
    expect(ls.isLocked(el)).toBe(false);
    expect(ls.toggle(el)).toBe(true);
    expect(ls.isLocked(el)).toBe(true);
    expect(ls.toggle(el)).toBe(false);
    expect(ls.isLocked(el)).toBe(false);
  });
});

describe('ReorderNodeCommand', () => {
  it('上移 undo 还原', () => {
    const doc = document.implementation.createHTMLDocument();
    const parent = doc.createElement('div');
    const a = doc.createElement('p'); a.id = 'a';
    const b = doc.createElement('p'); b.id = 'b';
    const c = doc.createElement('p'); c.id = 'c';
    parent.append(a, b, c);
    // b 上移：from=1 to=0
    const cmd = new ReorderNodeCommand(b, parent, 1, 0);
    cmd.execute();
    expect(parent.children[0]).toBe(b);
    expect(parent.children[1]).toBe(a);
    expect(parent.children[2]).toBe(c);
    cmd.undo();
    expect(parent.children[0]).toBe(a);
    expect(parent.children[1]).toBe(b);
    expect(parent.children[2]).toBe(c);
  });
  it('置底 undo 还原', () => {
    const doc = document.implementation.createHTMLDocument();
    const parent = doc.createElement('div');
    const a = doc.createElement('p');
    const b = doc.createElement('p');
    parent.append(a, b);
    const cmd = new ReorderNodeCommand(a, parent, 0, 1);
    cmd.execute();
    expect(parent.children[0]).toBe(b);
    expect(parent.children[1]).toBe(a);
    cmd.undo();
    expect(parent.children[0]).toBe(a);
    expect(parent.children[1]).toBe(b);
  });
  it('置顶/置底', () => {
    const doc = document.implementation.createHTMLDocument();
    const parent = doc.createElement('div');
    const a = doc.createElement('p'); const b = doc.createElement('p'); const c = doc.createElement('p');
    parent.append(a, b, c);
    const top = new ReorderNodeCommand(b, parent, 1, 0);
    top.execute();
    expect(parent.children[0]).toBe(b);
    top.undo();
    const bottom = new ReorderNodeCommand(a, parent, 0, 2);
    bottom.execute();
    expect(parent.children[2]).toBe(a);
    bottom.undo();
    expect(parent.children[0]).toBe(a);
  });
});

describe('collectRows 折叠/懒渲染', () => {
  it('折叠容器不展开子树', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div id=p><span>a</span></div><p id=q>x</p>';
    const rows = collectRows(doc, { expanded: new Set() });
    const tags = rows.map((r) => r.el.tagName);
    expect(tags).toContain('DIV');
    expect(tags).toContain('P');
    expect(rows.find((r) => r.el.id === 'p')?.hasChildren).toBe(true);
    // span 不应出现（折叠）
    expect(rows.some((r) => r.el.tagName === 'SPAN')).toBe(false);
  });
  it('展开后含子节点', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<div id=p><span>a</span></div>';
    const p = doc.body.querySelector('div')!;
    const rows = collectRows(doc, { expanded: new Set([p]) });
    expect(rows.some((r) => r.el.tagName === 'SPAN')).toBe(true);
  });
  it('perNodeLimit 截断并回调', () => {
    const doc = document.implementation.createHTMLDocument();
    const parent = doc.createElement('div');
    for (let i = 0; i < 5; i++) parent.appendChild(doc.createElement('p'));
    doc.body.appendChild(parent);
    let hidden = 0;
    const rows = collectRows(doc, {
      expanded: new Set([parent]),
      perNodeLimit: 2,
      onTruncated: (_p, n) => { hidden = n; },
    });
    expect(rows.filter((r) => r.el.tagName === 'P').length).toBe(2);
    expect(hidden).toBe(3);
  });
  it('跳过 head/script/ep- 节点', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<script>console.log(1)</script><div class="ep-x">x</div><p>real</p>';
    const rows = collectRows(doc, { expanded: new Set() });
    const tags = rows.map((r) => r.el.tagName);
    expect(tags).toContain('P');
    expect(tags).not.toContain('SCRIPT');
  });
});

describe('SetDisplayCommand', () => {
  it('隐藏/还原原 display', () => {
    const doc = document.implementation.createHTMLDocument();
    const el = doc.createElement('div');
    el.style.display = 'block';
    const cmd = new SetDisplayCommand(el, 'none', 'block');
    cmd.execute();
    expect(el.style.display).toBe('none');
    cmd.undo();
    expect(el.style.display).toBe('block');
  });
  it('原本无 display 还原为空', () => {
    const doc = document.implementation.createHTMLDocument();
    const el = doc.createElement('div');
    const cmd = new SetDisplayCommand(el, 'none', '');
    cmd.execute();
    expect(el.style.display).toBe('none');
    cmd.undo();
    expect(el.style.display).toBe('');
  });
});
