import { expect, test } from '@playwright/test';

// T108 样式面板：选中标题改字号/对齐 → 导出保留 → 撤销还原 → 面板双向同步
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

test('样式面板：改字号/对齐→导出保留→撤销还原', async ({ page }) => {
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

  // 1. 点击选中第一个 h2
  await h2.click();

  const panel = page.locator('aside.ep-panel');
  // 2. 改字号为 40（number input 第 1 个），提交 change
  const sizeInput = panel.locator('input[type=number]').nth(0);
  await sizeInput.fill('40');
  await sizeInput.dispatchEvent('change');
  await expect(h2).toHaveCSS('font-size', '40px');

  // 3. 改对齐为 center（select 第 3 个）
  const alignSelect = panel.locator('select').nth(2);
  await alignSelect.selectOption('center');
  await expect(h2).toHaveCSS('text-align', 'center');

  // 4. 撤销两次：对齐、字号
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(h2).not.toHaveCSS('text-align', 'center');
  await page.keyboard.press('Control+z');
  await expect(h2).not.toHaveCSS('font-size', '40px');

  // 5. 导出无 ep- / contenteditable 残留
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
