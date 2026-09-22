// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { matchAction, normalize, isEditingTarget } from '../../src/app/keymap';

type Ev = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
const ev = (key: string, ctrl = false, shift = false): Ev =>
  ({ key, ctrlKey: ctrl, metaKey: false, shiftKey: shift, altKey: false });

describe('keymap.matchAction', () => {
  it('Ctrl+Z undo', () => expect(matchAction(normalize(ev('z', true)))).toBe('undo'));
  it('Ctrl+Shift+Z redo', () => expect(matchAction(normalize(ev('z', true, true)))).toBe('redo'));
  it('Ctrl+Y redo', () => expect(matchAction(normalize(ev('y', true)))).toBe('redo'));
  it('Ctrl+S save', () => expect(matchAction(normalize(ev('s', true)))).toBe('save'));
  it('Ctrl+D duplicate', () => expect(matchAction(normalize(ev('d', true)))).toBe('duplicate'));
  it('Ctrl+L lock', () => expect(matchAction(normalize(ev('l', true)))).toBe('toggleLock'));
  it('Delete', () => expect(matchAction(normalize(ev('Delete')))).toBe('delete'));
  it('Arrow nudge', () => expect(matchAction(normalize(ev('ArrowLeft')))).toBe('nudge'));
  it('Escape', () => expect(matchAction(normalize(ev('Escape')))).toBe('escape'));
  it('Ctrl+B bold', () => expect(matchAction(normalize(ev('b', true)))).toBe('bold'));
});

describe('isEditingTarget', () => {
  it('input 不误触发', () => {
    const i = document.createElement('input');
    expect(isEditingTarget(i)).toBe(true);
  });
  it('textarea 不误触发', () => {
    const t = document.createElement('textarea');
    expect(isEditingTarget(t)).toBe(true);
  });
  it('普通元素放行', () => {
    const d = document.createElement('div');
    expect(isEditingTarget(d)).toBe(false);
  });
  it('contenteditable 放行给编辑态', () => {
    const d = document.createElement('div');
    d.setAttribute('contenteditable', 'true');
    expect(isEditingTarget(d)).toBe(true);
  });
});

import { resolveGuard } from '../../src/app/keymap';
describe('resolveGuard', () => {
  it('save/open 全局拦截', () => {
    expect(resolveGuard('save', 'input').execute).toBe(true);
    expect(resolveGuard('save', 'none').execute).toBe(true);
  });
  it('input 控件其余放行', () => {
    expect(resolveGuard('delete', 'input').execute).toBe(false);
    expect(resolveGuard('nudge', 'input').execute).toBe(false);
  });
  it('contenteditable B/I/U preventDefault+toast', () => {
    const r = resolveGuard('bold', 'contenteditable');
    expect(r.prevent).toBe(true);
    expect(r.execute).toBe(true);
    expect(r.prevent).toBe(true);
  });
  it('contenteditable delete 放行', () => {
    expect(resolveGuard('delete', 'contenteditable').execute).toBe(false);
  });
});
