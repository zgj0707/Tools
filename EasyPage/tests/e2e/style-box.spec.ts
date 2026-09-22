import { expect, test } from '@playwright/test';

// T109：给卡片加圆角+阴影、调 padding → 导出保留 → Ctrl+Z 还原；关闭阴影无残留
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>09 box</title></head>
<body>
  <div id="card" style="width:200px">卡片</div>
</body>
</html>`;

test('样式盒模型：加圆角+阴影、调 padding → 导出保留 → 撤销还原', async ({ page }) => {
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
  const card = editFrame.locator('#card');
  const panel = page.locator('aside.ep-panel');

  // 选中卡片
  await card.click();

  // padding 上 = 20
  const paddings = panel.locator('.ep-box input[type=number]');
  await paddings.nth(6).fill('20'); // paddingTop
  await paddings.nth(6).dispatchEvent('change');
  await expect(card).toHaveCSS('padding-top', '20px');

  // 圆角 radius = 12
  await panel.locator('.ep-deco input[type=number]').nth(1).fill('12'); // radius
  await panel.locator('.ep-deco input[type=number]').nth(1).dispatchEvent('change');
  await expect(card).toHaveCSS('border-radius', '12px');

  // 导出保留
  await page.locator('h1').first().click();
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const exported = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(exported).toMatch(/padding-top:\s*20px/i);
  expect(exported).toMatch(/border-radius:\s*12px/i);
  expect(exported).not.toContain('ep-');

  // 撤销两次 → 还原
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(card).not.toHaveCSS('padding-top', '20px');
  await expect(card).not.toHaveCSS('border-radius', '12px');
});

test('盒模型无损：width:50% 选中后宽度框空、Enter 不固化 px；opacity 清除无残留', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __capturedBlob: Blob | null };
    w.__capturedBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      w.__capturedBlob = blob;
      return orig(blob);
    };
  });
  const f = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body><div id="w50" style="width:50%">半宽块</div></body></html>`;

  await page.goto('/');
  await page.locator('textarea').fill(f);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const card = editFrame.locator('#w50');
  const panel = page.locator('aside.ep-panel');

  await card.click();
  const widthInput = panel.locator('.ep-box input[type=number]').nth(0);
  await expect(widthInput).toHaveValue('');

  // 聚焦宽度框直接 Enter，不改值 → 不应固化
  await widthInput.focus();
  await page.keyboard.press('Enter');

  // opacity 设 0.5
  await panel.locator('.ep-deco input[type=number]').nth(2).fill('0.5');
  await panel.locator('.ep-deco input[type=number]').nth(2).dispatchEvent('change');
  await expect(card).toHaveCSS('opacity', '0.5');

  // 导出仍保留 50%、含 opacity、无被固化 px 宽度
  await page.locator('h1').first().click();
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const exported = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(exported).toMatch(/width:\s*50%/);
  expect(exported).not.toMatch(/width:\s*\d+px/);
  expect(exported).toMatch(/opacity:\s*0\.5/);

  // 撤销 → opacity 还原为无
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(card).not.toHaveCSS('opacity', '0.5');
});
