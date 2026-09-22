// 命令历史栈（契约 01 §4 HistoryStack）。
// 内部 stack + pointer：stack[0..pointer-1] 为已执行命令，stack[pointer..] 为可 redo 分支。
// push 先 execute()，再截断 pointer 之后的 redo 分支并入栈。core 纯逻辑，不依赖 app/adapters/第三方。

import type { HistoryStack, ICommand } from '../ports';
import { SetTextCommand } from './commands';

export class HistoryStackImpl implements HistoryStack {
  private stack: ICommand[] = [];
  private pointer = 0;
  private listeners = new Set<() => void>();

  push(cmd: ICommand): void {
    // 空操作不入栈：SetTextCommand 新旧文本相同则不污染历史、不触发 onChange
    if (cmd instanceof SetTextCommand && cmd.prev === cmd.next) {
      cmd.execute();
      return;
    }
    cmd.execute();
    // 截断 pointer 之后的 redo 分支
    this.stack = this.stack.slice(0, this.pointer);
    this.stack.push(cmd);
    this.pointer = this.stack.length;
    this.emit();
  }

  undo(): void {
    if (this.pointer === 0) return;
    this.pointer -= 1;
    this.stack[this.pointer]?.undo();
    this.emit();
  }

  redo(): void {
    if (this.pointer >= this.stack.length) return;
    this.stack[this.pointer]?.execute();
    this.pointer += 1;
    this.emit();
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  clear(): void {
    this.stack = [];
    this.pointer = 0;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }
}
