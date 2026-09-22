import { expect, test } from '@playwright/test';

// T104 就地改字：双击改字→Enter 提交→Ctrl+Z 撤销→Ctrl+Shift+Z 重做→导出无残留
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>01 脚本轮播</title></head>
<body>
  <div class="carousel" id="main-carousel">
    <div class="slide active"><h2>第一张</h2><p>说明文字一</p></div>
    <div class="slide"><h2>第二张</h2><p>说明文字二</p></div>
  </div>
</body>
</html>`;

test('就地改字：双击改字→Enter 提交→撤销/重做→导出无残留', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __capturedBlob: Blob | null };
    w.__capturedBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      w.__capturedBlob = blob;
      return orig(blob);
    };
  });

  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const h2 = editFrame.locator('h2').first();

  // 1. 双击改字，按 Enter 提交
  await h2.dblclick();
  await h2.fill('新标题XYZ');
  await page.keyboard.press('Enter');
  await expect(h2).toHaveText('新标题XYZ');
  // 提交后临时标记已移除
  await expect(h2).not.toHaveAttribute('contenteditable');
  await expect(h2).not.toHaveAttribute('data-ep-editing');

  // 2. 点外壳标题把焦点移出 iframe，再撤销/重做
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(h2).toHaveText('第一张');
  await page.keyboard.press('Control+Shift+z');
  await expect(h2).toHaveText('新标题XYZ');

  // 3. 导出无 contenteditable / data-ep-editing / ep- 残留
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const exported = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(exported).not.toContain('contenteditable');
  expect(exported).not.toContain('data-ep-editing');
  expect(exported).not.toContain('ep-');
});
