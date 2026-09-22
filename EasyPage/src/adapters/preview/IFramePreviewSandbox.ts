// 预览沙箱（契约 01 §5）：
//   - 预览 iframe id="ep-preview-frame"，srcdoc + sandbox 逐字为 "allow-scripts"（绝不含 allow-same-origin），
//     用户脚本可运行但处于跨源沙箱，无法访问父页/外壳 DOM。
//   - 随 srcdoc 注入我方桥接脚本（bridge.ts）：收到父页 postMessage('ep:extract') 后回传
//     {type:'ep:extracted', html}。
//   - extract() 校验 event.source === previewFrame.contentWindow，2s 超时降级 resolve(null)（调用方复用编辑 doc）。

import { EP } from '../../constants';
import type { PreviewSandbox } from '../../core/ports';
import { injectBridge } from './bridge';

const EXTRACT_TIMEOUT_MS = 2000;

export class IFramePreviewSandbox implements PreviewSandbox {
  private frame: HTMLIFrameElement | null = null;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async open(html: string): Promise<void> {
    this.destroy();
    const frame = document.createElement('iframe');
    frame.id = EP.PREVIEW_FRAME;
    // 安全红线：逐字 "allow-scripts"，绝不含 allow-same-origin
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = injectBridge(html);
    // 尺寸与编辑帧一致，保留内联；描边 / 圆角 / 底色交给 style/app.css 的 #ep-preview-frame
    frame.style.width = '100%';
    frame.style.height = '600px';
    this.container.appendChild(frame);
    this.frame = frame;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, EXTRACT_TIMEOUT_MS);
      frame.addEventListener(
        'load',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  // 2s 超时降级返回 null，由调用方复用编辑 doc（不报错）。
  extract(): Promise<string | null> {
    const frame = this.frame;
    const win = frame?.contentWindow;
    if (!frame || !win) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        if (
          this.frame === frame &&
          event.source === win &&
          event.data &&
          event.data.type === 'ep:extracted' &&
          typeof event.data.html === 'string'
        ) {
          clearTimeout(timer);
          window.removeEventListener('message', onMessage);
          resolve(event.data.html);
        }
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, EXTRACT_TIMEOUT_MS);
      window.addEventListener('message', onMessage);
      win.postMessage('ep:extract', '*');
    });
  }

  destroy(): void {
    if (this.frame) {
      this.frame.remove();
      this.frame = null;
    }
  }
}
