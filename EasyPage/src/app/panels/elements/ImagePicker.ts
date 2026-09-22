// 图片选择器（T111）：URL / 占位 / 本地三来源弹层。外壳 ep- 节点，不进被编辑文档。
import { PLACEHOLDER_IMG } from '../../../core/elements/factory';

export class ImagePicker {
  private fileInput: HTMLInputElement;

  constructor() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
  }

  placeholder(): string {
    return PLACEHOLDER_IMG;
  }

  /** 本地上传：返回 objectURL（不网络请求），取消返回 null。 */
  pickLocal(): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      let focusTimer = 0;
      const onCancel = () => settle(null);
      const onFocus = () => {
        // 原生文件框关闭后窗口重新聚焦；延迟检查仍无文件视为取消（兜底）
        focusTimer = window.setTimeout(() => {
          if (!this.fileInput.files?.[0]) settle(null);
        }, 300);
      };
      const settle = (v: string | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        this.fileInput.removeEventListener('cancel', onCancel);
        this.fileInput.onchange = null;
        if (focusTimer) window.clearTimeout(focusTimer);
        resolve(v);
      };
      this.fileInput.value = '';
      this.fileInput.onchange = () => {
        const f = this.fileInput.files?.[0];
        settle(f ? URL.createObjectURL(f) : null);
      };
      this.fileInput.addEventListener('cancel', onCancel);
      window.addEventListener('focus', onFocus);
      this.fileInput.click();
    });
  }

  /** 弹层三来源：返回选中 src（isPlaceholder 标记），取消/空 → null。 */
  choose(): Promise<{ src: string; isPlaceholder: boolean } | null> {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      // 遮罩层的定位 / 铺满 / 居中 / 层级 / 底色全部由 app.css 的 .ep-image-picker 承担。
      modal.className = 'ep-image-picker';
      const box = document.createElement('div');
      // 卡片无对应类名：色值 / 内边距 / 圆角改用 token；width 属布局尺寸，保留。
      box.style.cssText = 'background:var(--ep-surface);padding:var(--ep-sp-4);border-radius:var(--ep-r-md);width:280px;';
      const url = document.createElement('input');
      url.type = 'text';
      url.placeholder = 'https://… 或 data:…';
      url.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:var(--ep-sp-2);';
      box.appendChild(url);

      const close = (v: { src: string; isPlaceholder: boolean } | null) => {
        modal.remove();
        resolve(v);
      };

      const urlBtn = document.createElement('button');
      urlBtn.textContent = '从 URL';
      urlBtn.style.cssText = 'display:block;width:100%;margin-bottom:var(--ep-sp-2);';
      urlBtn.addEventListener('click', () => {
        const s = url.value.trim();
        if (/^(https?:|data:)/i.test(s)) close({ src: s, isPlaceholder: false });
      });

      const phBtn = document.createElement('button');
      phBtn.textContent = '占位图';
      phBtn.style.cssText = 'display:block;width:100%;margin-bottom:var(--ep-sp-2);';
      phBtn.addEventListener('click', () => close({ src: PLACEHOLDER_IMG, isPlaceholder: true }));

      const localBtn = document.createElement('button');
      localBtn.textContent = '本地选择';
      localBtn.style.cssText = 'display:block;width:100%;margin-bottom:var(--ep-sp-2);';
      localBtn.addEventListener('click', async () => {
        const s = await this.pickLocal();
        close(s ? { src: s, isPlaceholder: false } : null);
      });

      const cancel = document.createElement('button');
      cancel.textContent = '取消';
      cancel.style.cssText = 'display:block;width:100%;';
      cancel.addEventListener('click', () => close(null));

      box.append(url, urlBtn, phBtn, localBtn, cancel);
      modal.appendChild(box);
      document.body.appendChild(modal);
      url.focus();
    });
  }
}
