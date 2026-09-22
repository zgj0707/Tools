import { expect, test } from '@playwright/test';

// T101 行走骨架：导入 → 编辑 iframe 渲染(脚本不跑) → 双击改字 → 预览(脚本可跑) → 导出(无残留)
// 内联 qa/fixtures/01-script-carousel.html 内容（types:[] 下不引入 node:fs）
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>01 脚本轮播</title></head>
<body>
  <div class="carousel" id="main-carousel">
    <div class="slide active" onclick="goSlide(0)"><h2>第一张</h2><p>说明文字一</p></div>
    <div class="slide" onclick="goSlide(1)"><h2>第二张</h2><p>说明文字二</p></div>
    <div class="slide" onclick="goSlide(2)"><h2>第三张</h2><p>说明文字三</p></div>
  </div>
  <button class="btn" type="button" onmouseover="this.style.opacity=0.8">了解更多</button>
  <script>
    function goSlide(i){ console.log('slide', i); }
  </script>
</body>
</html>`;

test('行走骨架：导入→改字→预览→导出', async ({ page }) => {
  // 拦截导出 Blob，用于在浏览器内读取下载内容（避开 node 类型）
  await page.addInitScript(() => {
    const w = window as unknown as { __capturedBlob: Blob | null };
    w.__capturedBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      w.__capturedBlob = blob;
      return orig(blob);
    };
  });

  // 1. 打开页面，粘贴 fixture 到 textarea，点导入
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');

  // 2. 编辑 iframe 中脚本不执行：h2 文本存在，且 goSlide 未被定义
  await expect(editFrame.locator('h2').first()).toHaveText('第一张');
  const goSlideType = await page.evaluate(() => {
    const frame = document.querySelector('#ep-canvas-frame') as HTMLIFrameElement | null;
    const win = frame?.contentWindow as Record<string, unknown> | undefined;
    return typeof win?.goSlide;
  });
  expect(goSlideType).toBe('undefined');

  // 3. 双击第一个 h2 改字，blur 后 textContent 已更新
  await editFrame.locator('h2').first().dblclick();
  await editFrame.locator('h2').first().fill('新标题ABC');
  await page.locator('textarea').click(); // 移出焦点触发 blur
  await expect(editFrame.locator('h2').first()).toHaveText('新标题ABC');

  // 4. 点预览：预览 iframe 出现且 sandbox 只有 allow-scripts
  await page.getByRole('button', { name: '预览' }).click();
  const previewFrame = page.locator('iframe#ep-preview-frame');
  await expect(previewFrame).toBeAttached();
  const sandboxVal = await previewFrame.getAttribute('sandbox');
  expect(sandboxVal).toBe('allow-scripts');
  expect(sandboxVal).not.toContain('allow-same-origin');

  // 5. 点导出：下载触发，且下载的 HTML 不含 'ep-' 与 'contenteditable'
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const exported = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(exported).not.toContain('ep-');
  expect(exported).not.toContain('contenteditable');
});
