// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { checkSelection, wrapTextNode, unwrapElement, findEnclosingWrap, normalizeUrl, type SelectionLike } from '../../src/core/inline/wrapInline';

describe('checkSelection', () => {
  it('合法单文本选区 ok', () => {
    const doc = new DOMParser().parseFromString('<p>hello</p>', 'text/html');
    const tn = doc.body.firstChild!.firstChild as Text;
    const r: SelectionLike = { collapsed: false, startContainer: tn, endContainer: tn, startOffset: 0, endOffset: 3 };
    expect(checkSelection(r).ok).toBe(true);
  });
  it('折叠 collapsed', () => {
    const doc = new DOMParser().parseFromString('<p>hi</p>', 'text/html');
    const tn = doc.body.firstChild!.firstChild as Text;
    const r: SelectionLike = { collapsed: true, startContainer: tn, endContainer: tn, startOffset: 0, endOffset: 0 };
    expect(checkSelection(r).reason).toBe('collapsed');
  });
  it('跨文本节点 crossNode', () => {
    const doc = new DOMParser().parseFromString('<p>a<b>b</b>c</p>', 'text/html');
    const t1 = doc.body.firstChild!.childNodes[0] as Text;
    const t2 = doc.querySelector('b')!.firstChild as Text;
    const r: SelectionLike = { collapsed: false, startContainer: t1, endContainer: t2, startOffset: 0, endOffset: 1 };
    expect(checkSelection(r).reason).toBe('crossNode');
  });
  it('startContainer 为元素 notText', () => {
    const doc = new DOMParser().parseFromString('<p>hi</p>', 'text/html');
    const p = doc.body.firstChild!;
    const r: SelectionLike = { collapsed: false, startContainer: p, endContainer: p, startOffset: 0, endOffset: 1 };
    expect(checkSelection(r).reason).toBe('notText');
  });
  it('仅空白 empty', () => {
    const doc = new DOMParser().parseFromString('<p>   </p>', 'text/html');
    const tn = doc.body.firstChild!.firstChild as Text;
    const r: SelectionLike = { collapsed: false, startContainer: tn, endContainer: tn, startOffset: 0, endOffset: 3 };
    expect(checkSelection(r).reason).toBe('empty');
  });
});

describe('wrapTextNode / unwrapElement', () => {
  it('包裹三段，解包还原', () => {
    const doc = new DOMParser().parseFromString('<p>hello world</p>', 'text/html');
    const tn = doc.body.firstChild!.firstChild as Text;
    const w = wrapTextNode(tn, 0, 5, 'strong');
    expect(w.tagName).toBe('STRONG');
    expect(doc.body.firstChild!.textContent).toBe('hello world');
    unwrapElement(w);
    expect(doc.body.firstChild!.textContent).toBe('hello world');
  });
});

describe('findEnclosingWrap', () => {
  it('在 strong 内返回 strong', () => {
    const doc = new DOMParser().parseFromString('<p><strong>hi</strong></p>', 'text/html');
    const tn = doc.querySelector('strong')!.firstChild as Text;
    const r: SelectionLike = { collapsed: false, startContainer: tn, endContainer: tn, startOffset: 0, endOffset: 2 };
    expect(findEnclosingWrap(r, 'strong')?.tagName).toBe('STRONG');
  });
});

describe('normalizeUrl', () => {
  it('域名补 https://', () => expect(normalizeUrl('example.com')).toBe('https://example.com'));
  it('http 保留', () => expect(normalizeUrl('http://x.com')).toBe('http://x.com'));
  it('mailto 保留', () => expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com'));
  it('# 锚点保留', () => expect(normalizeUrl('#top')).toBe('#top'));
  it('/ 相对保留', () => expect(normalizeUrl('/path')).toBe('/path'));
  it('javascript: 拒绝', () => expect(normalizeUrl('javascript:alert(1)')).toBeNull());
  it('data: 拒绝', () => expect(normalizeUrl('data:text/html,x')).toBeNull());
  it('空拒绝', () => expect(normalizeUrl('   ')).toBeNull());
});
