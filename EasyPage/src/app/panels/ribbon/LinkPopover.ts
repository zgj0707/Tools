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
    this.root.style.cssText = 'position:fixed;top:60px;right:20px;z-index:9999;background:#fff;border:1px solid #ccc;padding:8px;display:none;box-shadow:0 2px 8px rgba(0,0,0,.15);';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'https://example.com';
    this.input.style.cssText = 'width:220px;padding:4px;margin-right:8px;';
    const ok = document.createElement('button');
    ok.textContent = '确定';
    ok.style.cssText = 'padding:4px 10px;margin-right:4px;';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    cancel.style.cssText = 'padding:4px 10px;';
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
      this.input.style.border = '1px solid red';
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
