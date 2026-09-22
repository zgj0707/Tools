// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { HistoryStackImpl } from '../../src/core/commands/HistoryStack';
import { SetTextCommand } from '../../src/core/commands/commands';
import type { ICommand } from '../../src/core/ports';

function makeCmd(text: string, el: Element): ICommand {
  return new SetTextCommand(el, text, 'orig');
}

describe('HistoryStack', () => {
  it('20 步交错操作后全部 undo 回到初始，再 redo 全部还原', () => {
    const el = document.createElement('h2');
    el.textContent = 'a';
    const stack = new HistoryStackImpl();
    // 交错 push + undo + redo 各 20 步
    for (let i = 0; i < 20; i += 1) {
      stack.push(makeCmd(`v${i}`, el));
      if (i % 3 === 0) {
        stack.undo();
        stack.redo();
      }
    }
    // 全部 undo 应回到 'orig'（SetTextCommand.undo 写 'orig'）
    for (let i = 0; i < 20; i += 1) {
      stack.undo();
    }
    expect(el.textContent).toBe('orig');
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
    // redo 还原到最新
    for (let i = 0; i < 20; i += 1) {
      stack.redo();
    }
    expect(el.textContent).toBe('v19');
    expect(stack.canRedo()).toBe(false);
  });

  it('新操作截断旧 redo 分支', () => {
    const el = document.createElement('h2');
    const stack = new HistoryStackImpl();
    stack.push(new SetTextCommand(el, 'a', 'orig'));
    stack.push(new SetTextCommand(el, 'b', 'a'));
    stack.undo(); // 回到 'a'
    expect(stack.canRedo()).toBe(true);
    // 新操作应丢弃 redo 分支
    stack.push(new SetTextCommand(el, 'c', 'a'));
    expect(stack.canRedo()).toBe(false);
    stack.undo();
    expect(el.textContent).toBe('a');
  });

  it('空操作（next===prev）不入栈、不触发 onChange', () => {
    const el = document.createElement('h2');
    el.textContent = 'same';
    const stack = new HistoryStackImpl();
    let count = 0;
    stack.onChange(() => {
      count += 1;
    });
    stack.push(new SetTextCommand(el, 'same', 'same'));
    expect(stack.canUndo()).toBe(false);
    expect(count).toBe(0);
  });

  it('onChange 在 push/undo/redo/clear 时触发', () => {
    const el = document.createElement('h2');
    const stack = new HistoryStackImpl();
    let count = 0;
    const off = stack.onChange(() => {
      count += 1;
    });
    stack.push(new SetTextCommand(el, 'x', 'orig'));
    stack.undo();
    stack.redo();
    stack.clear();
    expect(count).toBe(4);
    off();
    stack.push(new SetTextCommand(el, 'y', 'x'));
    expect(count).toBe(4); // 取消订阅后不再增加
  });
});
