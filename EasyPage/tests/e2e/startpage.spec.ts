import { expect, test } from '@playwright/test';

const sample = `<!DOCTYPE html><html><head><title>T</title></head><body><p id="p1">hi</p><script>window.x=1;</script></body></html>`;

test('粘贴/空白进入', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(sample);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const edit = page.frameLocator('#ep-canvas-frame');
  expect(await edit.locator('#p1').textContent()).toBe('hi');

  await page.getByRole('button', { name: '新建空白' }).click();
  expect(await edit.locator('p').first().textContent()).toContain('开始编辑');
});


test('导出含脚本无残留', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __capturedBlob: Blob | null };
    w.__capturedBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => { w.__capturedBlob = blob; return orig(blob); };
  });
  await page.goto('/');
  await page.locator('textarea').fill(sample);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const out = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(out).toContain('<!DOCTYPE html>');
  expect(out).toContain('<script>');
  expect(out).not.toContain('contenteditable');
  expect(out).not.toContain('data-ep-editing');
  expect(out).not.toContain('ep-');
});

test('空内容导入报错', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill('');
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await expect(page.locator('.ep-toast')).toBeVisible();
});

test('上传入口 filechooser', async ({ page }) => {
  const fixture = 'tests/e2e/assets/upload.html';
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles(fixture);
  await expect(page.frameLocator('#ep-canvas-frame').locator('#p1')).toHaveText('hi');
});

test.skip('草稿续开', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(sample);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.frameLocator('#ep-canvas-frame').locator('#p1').evaluate((el) => { el.textContent = 'changed'; });
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  await page.reload();
  await page.getByRole('button', { name: '继续' }).click();
  expect(await page.frameLocator('#ep-canvas-frame').locator('#p1').textContent()).toBe('changed');
});
