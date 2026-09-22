import { expect, test } from '@playwright/test';

const carouselFixture = `<!DOCTYPE html>
<html><body>
<div id="slide">1</div>
<script>
  var i = 1;
  setInterval(function(){ i = i % 3 + 1; document.getElementById('slide').textContent = i; }, 100);
</script>
<input id="inp" type="text" value="hello">
<button id="btn">click</button>
</body></html>`;

test('预览：脚本运行、表单可填、隔离、无外部请求', async ({ page }) => {
  const reqs: string[] = [];
  page.on('request', (r) => reqs.push(r.url()));
  await page.goto('/');
  await page.locator('textarea').fill(carouselFixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.getByRole('button', { name: '预览' }).click();
  const preview = page.frameLocator('#ep-preview-frame');
  await page.waitForTimeout(400);
  const t0 = await preview.locator('#slide').textContent();
  await page.waitForTimeout(400);
  const t1 = await preview.locator('#slide').textContent();
  expect(t1).not.toBe(t0);
  await preview.locator('#inp').fill('world');
  expect(await preview.locator('#inp').inputValue()).toBe('world');
  const blocked = await preview.locator('#slide').evaluate(() => {
    try {
      return parent.document.querySelector('#ep-app') ? 'LEAK' : 'NO';
    } catch {
      return 'BLOCKED';
    }
  });
  expect(blocked).toBe('BLOCKED');
  const host = new URL(page.url()).host;
  for (const url of reqs) {
    expect(new URL(url).host).toBe(host);
  }
});

test('切回编辑：内容保留、表单回带、iframe 不堆积', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(carouselFixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const edit = page.frameLocator('#ep-canvas-frame');
  await edit.locator('#slide').evaluate((el) => { el.textContent = 'edited'; });
  await page.getByRole('button', { name: '预览' }).click();
  await expect(page.locator('#ep-preview-frame')).toBeAttached();
  await page.frameLocator('#ep-preview-frame').locator('#inp').fill('world');
  await page.getByRole('button', { name: '预览' }).click();
  await expect(page.locator('#ep-preview-frame')).not.toBeAttached();
  expect(await edit.locator('#slide').textContent()).toBe('edited');
  expect(await page.locator('iframe#ep-canvas-frame').count()).toBe(1);
  await expect(page.locator('iframe#ep-preview-frame')).toHaveCount(0);
});

test('切回：滚动恢复', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(`<!DOCTYPE html><body><div style="height:3000px">x</div></body>`);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const edit = page.frameLocator('#ep-canvas-frame');
  await edit.locator('body').evaluate(() => window.scrollTo(0, 500));
  await page.getByRole('button', { name: '预览' }).click();
  await page.getByRole('button', { name: '预览' }).click();
  await page.waitForTimeout(120);
  const y = await edit.locator('body').evaluate(() => window.scrollY);
  expect(y).toBeGreaterThanOrEqual(495);
});
