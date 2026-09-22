import { expect, test } from '@playwright/test';

// T111 插入元素：插入 button/table/img → 存在且选中 → 撤销移除 → 重做恢复
const fixture = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><p id="orig">原有段落</p></body></html>`;

test('插入元素：button/table/img 插入→选中→撤销→重做', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');

  // 插入按钮
  await panel.getByRole('button', { name: '按钮' }).click();
  await expect(editFrame.locator('button').last()).toHaveText('按钮');

  // 插入表格
  await panel.getByRole('button', { name: '表格' }).click();
  await expect(editFrame.locator('table').last()).toBeAttached();

  // 插入图片（弹层选占位图）
  await panel.getByRole('button', { name: '图片' }).click();
  await page.locator('.ep-image-picker').getByRole('button', { name: '占位图' }).click();
  const img = editFrame.locator('img').last();
  await expect(img).toBeAttached();
  await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml/);

  // 撤销 → 全部移除
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('table')).toHaveCount(0);
  await expect(editFrame.locator('img')).toHaveCount(0);

  // 重做 → 恢复
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(editFrame.locator('img')).toHaveCount(1);
  await expect(editFrame.locator('table')).toHaveCount(1);
});

test('图片三来源：data URI 插入无虚线边框；table 后插 button', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');
  const modal = page.locator('.ep-image-picker');

  await panel.getByRole('button', { name: '表格' }).click();
  const table = editFrame.locator('table').last();
  await expect(table).toBeAttached();

  await panel.getByRole('button', { name: '图片' }).click();
  await expect(modal).toBeVisible();
  await modal.locator('input[type=text]').fill('data:image/png;base64,iVBORw0KGgo=');
  await modal.getByRole('button', { name: '从 URL' }).click();
  const img = editFrame.locator('img').last();
  await expect(img).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
  await expect(modal).toBeHidden();

  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('img')).toHaveCount(0);

  await table.dispatchEvent('pointerdown');
  await panel.getByRole('button', { name: '按钮' }).click();
  await expect(editFrame.locator('button').last()).toBeAttached();
  await expect(table.locator('button')).toHaveCount(0);
});

test('本地 filechooser 插入 blob 图；取消不插入', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');
  const modal = page.locator('.ep-image-picker');

  await panel.getByRole('button', { name: '图片' }).click();
  const fc = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: '本地选择' }).click();
  (await fc).setFiles('tests/e2e/assets/px.png');
  const img = editFrame.locator('img').last();
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect(img).toHaveCSS('border-top-style', 'none');
  await expect(modal).toBeHidden();

  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('img')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(editFrame.locator('img')).toHaveCount(1);

  await page.keyboard.press('Control+z');
  const before = await editFrame.locator('img').count();
  await panel.getByRole('button', { name: '图片' }).click();
  const fc3 = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: '本地选择' }).click();
  (await fc3).setFiles([]);
  await expect(modal).toBeHidden();
  expect(await editFrame.locator('img').count()).toBe(before);
  await panel.getByRole('button', { name: '图片' }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: '取消' }).click();
});
