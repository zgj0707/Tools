// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectResidue, stripEditorArtifacts } from '../../src/core/serialize/stripArtifacts';

function docFromHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('stripEditorArtifacts', () => {
  it('移除 contenteditable 与 data-ep-editing（①）', () => {
    const doc = docFromHtml(
      '<body><h1 contenteditable="true" data-ep-editing="true">标题</h1></body>',
    );
    stripEditorArtifacts(doc);
    const h1 = doc.querySelector('h1') as HTMLElement;
    expect(h1.hasAttribute('contenteditable')).toBe(false);
    expect(h1.hasAttribute('data-ep-editing')).toBe(false);
    expect(h1.textContent).toBe('标题');
    expect(collectResidue(doc)).toHaveLength(0);
  });

  it('移除任意 data-ep-* 属性（②）', () => {
    const doc = docFromHtml('<body><p data-ep-foo="1" data-ep-bar="2">文本</p></body>');
    stripEditorArtifacts(doc);
    const p = doc.querySelector('p') as HTMLElement;
    expect(p.hasAttribute('data-ep-foo')).toBe(false);
    expect(p.hasAttribute('data-ep-bar')).toBe(false);
    expect(collectResidue(doc)).toHaveLength(0);
  });

  it('移除 #ep-overlay-root 覆盖层节点（③）', () => {
    const doc = docFromHtml(
      '<body><div id="ep-overlay-root"><div class="ep-box"></div></div><p>保留</p></body>',
    );
    stripEditorArtifacts(doc);
    expect(doc.getElementById('ep-overlay-root')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('保留');
    expect(collectResidue(doc)).toHaveLength(0);
  });

  it('移除编辑器注入的 <style id="ep-*"> / <script id="ep-*">（④）', () => {
    const doc = docFromHtml(
      '<head><style id="ep-style">.x{}</style><script id="ep-script">var x=1;</script></head><body><p>x</p></body>',
    );
    stripEditorArtifacts(doc);
    expect(doc.querySelector('style#ep-style')).toBeNull();
    expect(doc.querySelector('script#ep-script')).toBeNull();
    expect(collectResidue(doc)).toHaveLength(0);
  });

  it('移除仅编辑期 ep- 前缀临时 class，保留用户自有 class（⑤）', () => {
    const doc = docFromHtml(
      '<body><div class="ep-selected user-card ep-hover">内容</div></body>',
    );
    stripEditorArtifacts(doc);
    const div = doc.querySelector('div') as HTMLElement;
    expect(div.getAttribute('class')).toBe('user-card');
    expect(collectResidue(doc)).toHaveLength(0);
  });

  it('不动用户原始结构、class、id 与内联样式', () => {
    const doc = docFromHtml(
      '<body><div id="user-box" class="user-card" style="color:red"><h2>原标题</h2></div></body>',
    );
    stripEditorArtifacts(doc);
    const div = doc.querySelector('div') as HTMLElement;
    expect(div.id).toBe('user-box');
    expect(div.getAttribute('class')).toBe('user-card');
    expect(div.getAttribute('style')).toBe('color:red');
    expect(doc.querySelector('h2')?.textContent).toBe('原标题');
  });

  it('collectResidue 能在未清理前检出六类残留', () => {
    const doc = docFromHtml(
      '<head><style id="ep-s">a{}</style><script id="ep-j">1</script></head>' +
        '<body><div id="ep-overlay-root"></div>' +
        '<p contenteditable="true" data-ep-x="1" class="ep-foo">x</p></body>',
    );
    const residue = collectResidue(doc);
    const kinds = residue.map((r) => r.kind).sort();
    expect(kinds).toEqual(
      [
        '<script id="ep-*">',
        '<style id="ep-*">',
        'class="ep-*"',
        'contenteditable',
        'data-ep-*',
        'ep-overlay-root',
      ].sort(),
    );
  });
});
