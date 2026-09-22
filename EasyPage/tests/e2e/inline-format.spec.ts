import { expect, test } from '@playwright/test';

const fixture = `<!DOCTYPE html><body><p id="p1">Hello World</p></body>`;
const twoFixture = `<!DOCTYPE html><body><p id="p1">AAA</p><p id="p2">BBB</p></body>`;

test('Ctrl+B 选区加粗生成 strong，撤销还原', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate((el) => {
    const range = document.createRange();
    const tn = el.firstChild as Text;
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+b');
  expect(await editFrame.locator('#p1 strong').count()).toBe(1);
  expect(await editFrame.locator('#p1').textContent()).toBe('Hello World');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect(await editFrame.locator('#p1 strong').count()).toBe(0);
  expect(await editFrame.locator('#p1').textContent()).toBe('Hello World');
});

test('Ctrl+B toggle：加粗再取消，撤销重做', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate((el) => {
    const range = document.createRange();
    const tn = el.firstChild as Text;
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+b');
  expect(await editFrame.locator('#p1 strong').count()).toBe(1);
  await editFrame.locator('#p1 strong').evaluate((el) => {
    const range = document.createRange();
    const tn = el.firstChild as Text;
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+b');
  expect(await editFrame.locator('#p1 strong').count()).toBe(0);
  await page.keyboard.press('Control+z');
  expect(await editFrame.locator('#p1 strong').count()).toBe(1);
  await page.keyboard.press('Control+y');
  expect(await editFrame.locator('#p1 strong').count()).toBe(0);
  expect(await editFrame.locator('#p1').textContent()).toBe('Hello World');
  await page.keyboard.press('Escape');
});

test('跨元素选区不支持', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(twoFixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate(() => {
    const range = document.createRange();
    const t1 = document.querySelector('#p1')!.firstChild as Text;
    const t2 = document.querySelector('#p2')!.firstChild as Text;
    range.setStart(t1, 0); range.setEnd(t2, 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+b');
  expect(await editFrame.locator('strong').count()).toBe(0);
  await expect(page.locator('.ep-toast')).toContainText('选区');
  await page.keyboard.press('Escape');
});

test('Ctrl+K 链接：example.com → https://example.com，撤销还原', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate((el) => {
    const range = document.createRange();
    const tn = el.firstChild as Text;
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+k');
  await page.locator('.ep-link-popover input').fill('example.com');
  await page.getByRole('button', { name: '确定' }).click();
  const href = await editFrame.locator('#p1 a').getAttribute('href');
  expect(href).toBe('https://example.com');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect(await editFrame.locator('#p1 a').count()).toBe(0);
});

test('Ctrl+K javascript: 拒绝', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate((el) => {
    const range = document.createRange();
    const tn = el.firstChild as Text;
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+k');
  await page.locator('.ep-link-popover input').fill('javascript:alert(1)');
  await page.getByRole('button', { name: '确定' }).click();
  await expect(page.locator('.ep-link-popover')).toBeVisible();
  expect(await editFrame.locator('a').count()).toBe(0);
  await page.keyboard.press('Escape');
});

test('导出无残留', async ({ page }) => {
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
  await editFrame.locator('#p1').dblclick();
  await editFrame.locator('#p1').evaluate((el) => {
    const range = document.createRange();
    const tn = el.firstChild as Text;
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Tab');
  await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const out = await page.evaluate(async () => {
    const blob = (window as unknown as { __capturedBlob: Blob | null }).__capturedBlob;
    return blob ? blob.text() : '';
  });
  expect(out.length).toBeGreaterThan(0);
  expect(out).toMatch(/<html/i);
  expect(out).toMatch(/<strong[\s>]/i);
  expect(out).toContain('Hello');
  expect(out).not.toContain('contenteditable');
  expect(out).not.toContain('data-ep-editing');
  expect(out).not.toContain('ep-');
});
