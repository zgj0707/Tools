// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildBar, type Bar, type BarHandlers } from '../../src/extension/ui/bar';

const NOOP: BarHandlers = {
  onToggleEditMode: () => {},
  onHide: () => {},
  onToggleFormat: () => {},
  onPickColor: () => {},
  onUndo: () => {},
  onRedo: () => {},
  onSave: () => {},
};

function saveButton(bar: Bar): HTMLButtonElement {
  const btn = [...bar.element.querySelectorAll('button')].find((b) => b.textContent === '覆盖原件');
  if (!btn) throw new Error('工具条里找不到「覆盖原件」按钮');
  return btn as HTMLButtonElement;
}

describe('保存按钮 · 覆盖当前原件', () => {
  it('说明每次写入前都会确认，首次选择已有 HTML 原件', () => {
    const bar = buildBar(document, NOOP);
    bar.setSaveState({ available: true, target: 'index.html' });
    expect(saveButton(bar).title).toBe(
      '每次保存都会先确认是否覆盖 index.html。首次选择一个已有 HTML 文件作为原件；取消确认不会写入。',
    );
    expect([...bar.element.querySelectorAll('button')].some((b) => b.textContent === '保存目录')).toBe(false);
  });

  it('忙碌状态禁用保存按钮并在完成后恢复', () => {
    const bar = buildBar(document, NOOP);
    bar.setSaveState({ available: true, target: 'index.html' });
    bar.setSaveState({ available: true, busy: true });
    expect(saveButton(bar).disabled).toBe(true);
    expect(saveButton(bar).getAttribute('aria-busy')).toBe('true');
    bar.setSaveState({ available: true });
    expect(saveButton(bar).disabled).toBe(false);
    expect(saveButton(bar).getAttribute('aria-busy')).toBe('false');
    expect(saveButton(bar).title).toContain('index.html');
  });

  it('不可用时禁用按钮并说明本地文件访问能力缺失', () => {
    const bar = buildBar(document, NOOP);
    bar.setSaveState({ available: false });
    expect(saveButton(bar).disabled).toBe(true);
    expect(saveButton(bar).title).toContain('本地文件访问能力');
  });

  it('调用方给出具体原因时保留该原因', () => {
    const bar = buildBar(document, NOOP);
    bar.setSaveState({ available: false, reason: '正在恢复原件访问…' });
    expect(saveButton(bar).title).toBe('正在恢复原件访问…');
  });
});
