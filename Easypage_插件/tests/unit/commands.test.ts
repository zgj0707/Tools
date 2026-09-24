// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  BatchCommand,
  InsertNodeCommand,
  RemoveNodeCommand,
  ResizeCommand,
  SetAttributeCommand,
  SetStyleCommand,
  SetTextCommand,
} from '../../src/core/commands/commands';

describe('SetTextCommand', () => {
  it('execute 写 next，undo 写 prev', () => {
    const el = document.createElement('h2');
    el.textContent = 'old';
    const cmd = new SetTextCommand(el, 'new', 'old');
    cmd.execute();
    expect(el.textContent).toBe('new');
    cmd.undo();
    expect(el.textContent).toBe('old');
  });
});

describe('SetStyleCommand', () => {
  it('execute 写 props，undo 从 prev 恢复', () => {
    const el = document.createElement('div');
    el.style.color = 'red';
    const prev = new Map<Element, Record<string, string>>([[el, { color: 'red' }]]);
    const cmd = new SetStyleCommand([el], { color: 'blue', fontWeight: 'bold' }, prev);
    cmd.execute();
    expect(el.style.color).toBe('blue');
    expect(el.style.fontWeight).toBe('bold');
    cmd.undo();
    expect(el.style.color).toBe('red');
    expect(el.style.fontWeight).toBe('');
  });
});

describe('BatchCommand', () => {
  it('execute 顺序执行，undo 逆序回滚', () => {
    const a = document.createElement('h2');
    const b = document.createElement('p');
    a.textContent = 'a0';
    b.textContent = 'b0';
    const cmd = new BatchCommand('batch', [
      new SetTextCommand(a, 'a1', 'a0'),
      new SetTextCommand(b, 'b1', 'b0'),
    ]);
    cmd.execute();
    expect(a.textContent).toBe('a1');
    expect(b.textContent).toBe('b1');
    cmd.undo();
    // 逆序：先 b 后 a 恢复
    expect(b.textContent).toBe('b0');
    expect(a.textContent).toBe('a0');
  });
});

describe('InsertNodeCommand', () => {
  it('execute 插入到指定 index，undo 移除', () => {
    const parent = document.createElement('div');
    parent.appendChild(document.createElement('span'));
    const node = document.createElement('em');
    const cmd = new InsertNodeCommand(node, parent, 0);
    cmd.execute();
    expect(parent.children[0]).toBe(node);
    cmd.undo();
    expect(parent.children.length).toBe(1);
  });
});

describe('RemoveNodeCommand', () => {
  it('execute 移除节点并记住 parent/index，undo 原位插回', () => {
    const parent = document.createElement('div');
    const first = document.createElement('span');
    const node = document.createElement('em');
    parent.appendChild(first);
    parent.appendChild(node);
    const cmd = new RemoveNodeCommand(node);
    cmd.execute();
    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBe(first);
    cmd.undo();
    expect(parent.children[1]).toBe(node);
  });
});

describe('SetAttributeCommand', () => {
  it('execute 设置/移除属性，undo 恢复', () => {
    const el = document.createElement('div');
    const add = new SetAttributeCommand(el, 'data-x', '1', null);
    add.execute();
    expect(el.getAttribute('data-x')).toBe('1');
    add.undo();
    expect(el.getAttribute('data-x')).toBeNull();
  });
});

describe('ResizeCommand（无损）', () => {
  it('原 width:50% 元素 execute 变 px，undo 精确恢复为 50%', () => {
    const el = document.createElement('div');
    el.style.width = '50%';
    el.style.height = '80px';
    const cmd = new ResizeCommand(
      [el],
      { width: 200, height: 100 },
      { width: '50%', height: '80px' },
    );
    cmd.execute();
    expect(el.style.width).toBe('200px');
    cmd.undo();
    expect(el.style.width).toBe('50%');
    expect(el.style.height).toBe('80px');
  });

  it('原本无 inline 宽高的元素 undo 后无残留', () => {
    const el = document.createElement('div');
    const cmd = new ResizeCommand(
      [el],
      { width: 200, height: 100 },
      { width: null, height: null },
    );
    cmd.execute();
    expect(el.style.width).toBe('200px');
    cmd.undo();
    expect(el.style.width).toBe('');
    expect(el.style.height).toBe('');
  });
});
