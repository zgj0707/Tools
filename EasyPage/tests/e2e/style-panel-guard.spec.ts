import { expect, test } from '@playwright/test';

// T108 补齐：能力守卫（block-only 禁用）+ 链接 href 设置/撤销/导出保留
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>01 脚本轮播</title></head>
<body>
  <div class="slide"><h2 id="t1">标题一</h2><p>说明文字一</p></div>
  <a id="link1" href="https://example.com/old">原链接</a>
  <hr id="sv1">
</body>
</html>`;

test('样式面板：block-only 元素禁用控件；<a> 设 href→导出保留→撤销还原', async ({ page }) => {
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
  const panel = page.locator('aside.ep-panel');

  // 1. 选中 hr（non-editable）→ 文字控件 disabled 且出现提示
  await editFrame.locator('#sv1').click();
  await expect(panel.locator('input[type=number]').nth(0)).toBeDisabled();
  await expect(panel.locator('.ep-notice')).toHaveText(/block-only|不可/);

  // 2. 选中 <a>（合成 pointerdown 避免真实点击导航 iframe）→ 链接框启用并回填
  await editFrame.locator('#link1').dispatchEvent('pointerdown');
  const linkInput = panel.locator('input[type=text]');
  await expect(linkInput).toBeEnabled();
  await expect(linkInput).toHaveValue('https://example.com/old');

  // 3. 改成新 href，提交
  await linkInput.fill('https://example.com/new');
  await linkInput.dispatchEvent('change');
  await expect(editFrame.locator('#link1')).toHaveAttribute('href', 'https://example.com/new');

  // 4. 导出包含新 href，且无 ep- 残留
  await page.locator('h1').first().click();
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const exported = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(exported).toContain('https://example.com/new');
  expect(exported).not.toContain('ep-');

  // 5. 撤销 → href 还原为旧值
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('#link1')).toHaveAttribute('href', 'https://example.com/old');
});
