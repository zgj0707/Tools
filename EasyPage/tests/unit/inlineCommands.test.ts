// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { InlineWrapCommand } from '../../src/core/commands/inlineCommands';

describe('InlineWrapCommand wrap', () => {
  it('选中 bbb 包 strong，undo 还原单文本节点', () => {
    const doc = new DOMParser().parseFromString('<p>aaabbbccc</p>', 'text/html');
    const p = doc.querySelector('p')!;
    const tn = p.firstChild as Text;
    const cmd = InlineWrapCommand.wrap(tn, 3, 6, 'strong');
    cmd.execute();
    expect(p.textContent).toBe('aaabbbccc');
    expect(p.querySelector('strong')?.textContent).toBe('bbb');
    cmd.undo();
    expect(p.childNodes.length).toBe(1);
    expect(p.firstChild!.textContent).toBe('aaabbbccc');
    cmd.redo();
    expect(p.querySelector('strong')?.textContent).toBe('bbb');
  });

  it('句首 wrap(0,3) undo 还原', () => {
    const doc = new DOMParser().parseFromString('<p>aaabbbccc</p>', 'text/html');
    const p = doc.querySelector('p')!;
    const tn = p.firstChild as Text;
    const cmd = InlineWrapCommand.wrap(tn, 0, 3, 'strong');
    cmd.execute();
    expect(p.querySelector('strong')?.textContent).toBe('aaa');
    cmd.undo();
    expect(p.childNodes.length).toBe(1);
    expect(p.firstChild!.textContent).toBe('aaabbbccc');
    cmd.redo();
    expect(p.querySelector('strong')?.textContent).toBe('aaa');
  });

  it('句尾 wrap(6,9) undo 还原', () => {
    const doc = new DOMParser().parseFromString('<p>aaabbbccc</p>', 'text/html');
    const p = doc.querySelector('p')!;
    const tn = p.firstChild as Text;
    const cmd = InlineWrapCommand.wrap(tn, 6, 9, 'strong');
    cmd.execute();
    expect(p.querySelector('strong')?.textContent).toBe('ccc');
    cmd.undo();
    expect(p.childNodes.length).toBe(1);
    expect(p.firstChild!.textContent).toBe('aaabbbccc');
    cmd.redo();
    expect(p.querySelector('strong')?.textContent).toBe('ccc');
  });

  it('兄弟元素间 wrap，undo 保持兄弟顺序', () => {
    const doc = new DOMParser().parseFromString('<p><b>x</b>aaabbbccc<i>y</i></p>', 'text/html');
    const p = doc.querySelector('p')!;
    const tn = p.childNodes[1] as Text;
    const cmd = InlineWrapCommand.wrap(tn, 3, 6, 'strong');
    cmd.execute();
    expect(p.querySelector('strong')?.textContent).toBe('bbb');
    cmd.undo();
    expect(p.textContent).toBe('xaaabbbcccy');
    expect((p.childNodes[0] as Node).nodeName).toBe('B');
    expect((p.childNodes[1] as Node).textContent).toBe('aaabbbccc');
    expect((p.childNodes[2] as Node).nodeName).toBe('I');
    cmd.redo();
    expect(p.querySelector('strong')?.textContent).toBe('bbb');
    expect((p.childNodes[0] as Node).nodeName).toBe('B');
    expect((p.childNodes[4] as Node).nodeName).toBe('I');
  });
});

describe('InlineWrapCommand unwrap', () => {
  it('a<strong>b</strong>c 解包还原兄弟文本，undo 原样插回', () => {
    const doc = new DOMParser().parseFromString('<p>a<strong>b</strong>c</p>', 'text/html');
    const p = doc.querySelector('p')!;
    const strong = p.querySelector('strong')!;
    const cmd = InlineWrapCommand.unwrap(strong as HTMLElement);
    cmd.execute();
    expect(p.querySelector('strong')).toBeNull();
    expect(p.textContent).toBe('abc');
    expect(p.childNodes.length).toBe(3);
    cmd.undo();
    expect(p.querySelector('strong')?.textContent).toBe('b');
    expect(p.childNodes.length).toBe(3);
    cmd.redo();
    expect(p.querySelector('strong')).toBeNull();
  });
});
