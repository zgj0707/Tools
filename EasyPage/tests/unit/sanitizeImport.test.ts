import { describe, expect, it } from 'vitest';
import { sanitizeImport } from '../../src/core/io/sanitizeImport';

describe('sanitizeImport', () => {
  it('移除 onclick', () => {
    const out = sanitizeImport('<div onclick="alert(1)">x</div>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('<div');
  });
  it('移除 javascript: href', () => {
    const out = sanitizeImport('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
  it('保留用户原始 script', () => {
    const out = sanitizeImport('<script>window.x=1;</script><p>x</p>');
    expect(out).toContain('<script>');
    expect(out).toContain('window.x=1');
  });
});
