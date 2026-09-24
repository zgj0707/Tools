import { describe, expect, it } from 'vitest';
import { isDangerousUrl, sanitizeImport } from '../../src/core/io/sanitizeImport';

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

// 2026-09-22 加固：补齐混淆写法与旁路通道（原实现只覆盖"带引号的事件处理器 + javascript: URL"）
describe('sanitizeImport · 加固', () => {
  it('移除无引号事件处理器，且不误删同标签其他属性', () => {
    const out = sanitizeImport('<img src="x.png" onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).toContain('src="x.png"');
  });

  it('移除大小写混合的事件处理器', () => {
    const out = sanitizeImport('<div OnClick="alert(1)">x</div>');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('移除实体编码混淆的协议', () => {
    expect(sanitizeImport('<a href="java&#115;cript:alert(1)">x</a>')).not.toContain('&#115;');
    expect(sanitizeImport('<a href="java&#x73;cript:alert(1)">x</a>')).not.toContain('&#x73;');
  });

  it('移除空白混淆的协议', () => {
    expect(sanitizeImport('<a href="java\tscript:alert(1)">x</a>')).not.toContain('script:');
  });

  it('移除 vbscript 与 data:text/html', () => {
    expect(sanitizeImport('<a href="vbscript:msgbox(1)">x</a>')).not.toContain('vbscript');
    expect(
      sanitizeImport('<iframe src="data:text/html,<script>1</script>"></iframe>'),
    ).not.toContain('data:text/html');
  });

  it('移除 srcdoc', () => {
    const out = sanitizeImport('<iframe srcdoc="<script>alert(1)</script>"></iframe>');
    expect(out).not.toContain('srcdoc');
  });

  it('移除 meta refresh 与 base', () => {
    expect(sanitizeImport('<meta http-equiv="refresh" content="0;url=http://evil.test">')).toBe('');
    expect(sanitizeImport('<base href="http://evil.test/">')).toBe('');
  });

  it('移除内联 style 里的 expression 与 javascript:', () => {
    expect(sanitizeImport('<div style="width:expression(alert(1))">x</div>')).not.toContain(
      'expression',
    );
    expect(
      sanitizeImport('<div style="background:url(javascript:alert(1))">x</div>'),
    ).not.toContain('javascript');
  });

  it('不误伤正常 URL、data: 图片与内联样式', () => {
    const html =
      '<a href="https://example.com/a?b=1">x</a><img src="data:image/png;base64,AAA"><div style="color:#333">y</div>';
    expect(sanitizeImport(html)).toBe(html);
  });

  it('isDangerousUrl 只认危险协议', () => {
    expect(isDangerousUrl('javascript:alert(1)')).toBe(true);
    expect(isDangerousUrl('JaVaScRiPt:alert(1)')).toBe(true);
    expect(isDangerousUrl('java\nscript:alert(1)')).toBe(true);
    expect(isDangerousUrl('https://example.com')).toBe(false);
    expect(isDangerousUrl('data:image/png;base64,AAA')).toBe(false);
    expect(isDangerousUrl('mailto:a@b.c')).toBe(false);
    expect(isDangerousUrl('#anchor')).toBe(false);
  });
});
