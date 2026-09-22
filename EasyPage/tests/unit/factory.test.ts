// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { create, createImage, insertionPoint, PLACEHOLDER_IMG } from '../../src/core/elements/factory';

describe('factory.create', () => {
  it('用传入 document 生成节点', () => {
    const doc = document.implementation.createHTMLDocument();
    const h1 = create(doc, 'h1');
    expect(h1.ownerDocument).toBe(doc);
    expect((h1 as HTMLElement).tagName).toBe('H1');
  });
  it('table 2×2 带边框', () => {
    const doc = document.implementation.createHTMLDocument();
    const t = create(doc, 'table') as HTMLTableElement;
    expect(t.rows.length).toBe(2);
    expect(t.rows[0]?.cells.length).toBe(2);
  });
  it('img 用占位 data URI', () => {
    const doc = document.implementation.createHTMLDocument();
    const img = create(doc, 'img') as HTMLImageElement;
    expect(img.src).toContain('data:image/svg+xml');
    expect(img.src).toContain(PLACEHOLDER_IMG.slice(0, 30));
  });
  it('button 文本', () => {
    const doc = document.implementation.createHTMLDocument();
    expect((create(doc, 'button') as HTMLElement).textContent).toBe('按钮');
  });
  it('createImage 占位有 dashed 边框，真实 src 无', () => {
    const doc = document.implementation.createHTMLDocument();
    const ph = createImage(doc, PLACEHOLDER_IMG, true);
    expect(ph.style.border).toContain('dashed');
    const real = createImage(doc, 'https://x/y.png');
    expect(real.style.border).toBe('');
    expect(real.ownerDocument).toBe(doc);
  });
});

describe('insertionPoint 三规则', () => {
  it('无选中 → body 末尾', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.appendChild(doc.createElement('p'));
    const p = insertionPoint(doc, null);
    expect(p.parent).toBe(doc.body);
    expect(p.index).toBe(1);
  });
  it('选中容器 → 内部末尾', () => {
    const doc = document.implementation.createHTMLDocument();
    const div = doc.createElement('div');
    doc.body.appendChild(div);
    const p = insertionPoint(doc, div);
    expect(p.parent).toBe(div);
    expect(p.index).toBe(0);
  });
  it('选中叶子 → 其后', () => {
    const doc = document.implementation.createHTMLDocument();
    const a = doc.createElement('p');
    const b = doc.createElement('p');
    doc.body.append(a, b);
    const p = insertionPoint(doc, a);
    expect(p.parent).toBe(doc.body);
    expect(p.index).toBe(1);
  });
  it('选中 table → 按叶子插到 table 之后', () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.appendChild(doc.createElement('p'));
    const table = create(doc, 'table') as HTMLElement;
    doc.body.appendChild(table);
    const p = insertionPoint(doc, table);
    expect(p.parent).toBe(doc.body);
    expect(p.index).toBe(2);
  });
});
