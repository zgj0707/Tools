// 锁定状态（T112）：纯内存 WeakSet，绝不写入被编辑 DOM。
export class LockState {
  private locked = new WeakSet<Element>();

  isLocked(el: Element): boolean {
    return this.locked.has(el);
  }

  toggle(el: Element): boolean {
    if (this.locked.has(el)) {
      this.locked.delete(el);
      return false;
    }
    this.locked.add(el);
    return true;
  }
}
