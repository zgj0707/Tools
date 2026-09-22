// T114b 链接输入弹层（外壳 ep- 节点，不进被编辑文档）。
import { normalizeUrl } from '../../../core/inline/wrapInline';

export interface LinkPopoverResult {
  url: string;
}

export class LinkPopover {
  private root: HTMLDivElement;
  private input: HTMLInputElement;
  private resolve: ((r: LinkPopoverResult | null) => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ep-link-popover';
    // 底色 / 边框 / 圆角 / 阴影 / 层级（z-index:9999）已由 app.css 的 .ep-link-popover
    // 承担；这里只留定位几何（fixed + 右上角偏移）与显隐状态（display）。
    this.root.style.cssText = 'position:fixed;top:60px;right:20px;display:none;';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'https://example.com';
    // width 为布局尺寸，保留；内边距与右间距改用 token。
    this.input.style.cssText = 'width:220px;padding:var(--ep-sp-1);margin-right:var(--ep-sp-2);';
    const ok = document.createElement('button');
    ok.textContent = '确定';
    ok.style.cssText = 'padding:var(--ep-sp-1) 10px;margin-right:var(--ep-sp-1);';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.style.cssText = 'padding:var(--ep-sp-1) 10px;';
    ok.addEventListener('click', () => this.submit());
    cancel.addEventListener('click', () => this.close(null));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.close(null);
    });
    this.root.appendChild(this.input);
    this.root.appendChild(ok);
    this.root.appendChild(cancel);
    host.appendChild(this.root);
  }

  private submit(): void {
    const url = normalizeUrl(this.input.value);
    if (url === null) {
      // 校验失败的红色报警描边走 token（唯一色值来源），状态本身仍由 JS 控制。
      this.input.style.border = '1px solid var(--ep-danger)';
      return;
    }
    this.close({ url });
  }

  private close(result: LinkPopoverResult | null): void {
    this.root.style.display = 'none';
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(result);
    }
  }

  open(): Promise<LinkPopoverResult | null> {
    this.input.value = '';
    this.input.style.border = '';
    this.root.style.display = 'block';
    this.input.focus();
    return new Promise((resolve) => { this.resolve = resolve; });
  }
}
