// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { duplicateNode, uniqueId } from '../../src/core/elements/duplicate';

describe('duplicateNode', () => {
  it('深拷贝到同父之后，剥除编辑器标记，新 id 唯一', () => {
    const doc = new DOMParser().parseFromString(
      '<body><p id="x" class="card ep-selected" contenteditable data-ep-editing>hi</p></body>', 'text/html');
    const src = doc.querySelector('p')!;
    const clone = duplicateNode(doc, src);
    expect(clone).not.toBe(src);
    expect(clone.parentElement).toBe(src.parentElement);
    expect(Array.from(src.parentElement!.children).indexOf(clone)).toBe(1);
    expect(clone.getAttribute('contenteditable')).toBeNull();
    expect(clone.hasAttribute('data-ep-editing')).toBe(false);
    expect(clone.classList.contains('ep-selected')).toBe(false);
    expect(clone.id).not.toBe('x');
    expect(doc.getElementById(clone.id)).toBe(clone);
  });

  it('无 id 源节点不生成 id', () => {
    const doc = new DOMParser().parseFromString('<body><p>hi</p></body>', 'text/html');
    const src = doc.querySelector('p')!;
    const clone = duplicateNode(doc, src);
    expect(clone.id).toBe('');
  });

  it('uniqueId 递增', () => {
    const doc = new DOMParser().parseFromString('<body><p id="a-copy"></p></body>', 'text/html');
    expect(uniqueId(doc, 'a')).toBe('a-copy-2');
  });
});

describe('stripEditorMarkups data-ep-*', () => {
  it('剥 data-ep-* 但保留普通 data-*', () => {
    const doc = new DOMParser().parseFromString('<body><p id="x" class="card ep-selected" data-ep-editing data-ep-foo="1" data-x="keep" contenteditable>hi</p></body>', 'text/html');
    const src = doc.querySelector('p')!;
    const clone = duplicateNode(doc, src);
    expect(clone.hasAttribute('data-ep-editing')).toBe(false);
    expect(clone.hasAttribute('data-ep-foo')).toBe(false);
    expect(clone.getAttribute('data-x')).toBe('keep');
    expect(clone.classList.contains('card')).toBe(true);
    expect(clone.classList.contains('ep-selected')).toBe(false);
  });
});
