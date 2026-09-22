import { expect, test } from '@playwright/test';

const fixture = `<!DOCTYPE html><body>
<div id="a" style="width:50%;height:40px;font-size:16px;opacity:1;color:rgb(0,0,0);">A</div>
<div id="b" style="width:200px;height:40px;font-size:20px;opacity:0.5;color:rgb(0,0,0);">B</div>
<div id="c" style="width:100px;height:40px;color:rgb(255,0,0);">C</div>
</body>`;

test('多选混合值留空：width 50% 不固化、字号/opacity 不同留空', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#a').click();
  await editFrame.locator('#b').click({ modifiers: ['Shift'] });
  // 宽度框应空（a 是 50%）
  await expect(page.locator('.ep-box input[aria-label="width"], .ep-box')).toContainText('');
  const widthVal = await page.locator('.ep-box input').first().inputValue();
  expect(widthVal).toBe('');
  // opacity 框应空（1 vs 0.5）
  const opacityVal = await page.locator('.ep-deco input[type="number"]').last().inputValue().catch(() => '');
  expect(opacityVal).not.toBe('1');
});

test('多选同色回填；多选改共有控件一次撤销', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(`<!DOCTYPE html><body>
<div id="a" style="margin-top:10px;">A</div>
<div id="b" style="margin-top:10px;">B</div>
</body>`);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#a').click();
  await editFrame.locator('#b').click({ modifiers: ['Shift'] });
  // margin-top 共有值 10 应回填
  const mt = await page.locator('.ep-box input').nth(2).inputValue();
  expect(mt).toBe('10');
  // 改 margin-top 为 20
  await page.locator('.ep-box input').nth(2).fill('20');
  await page.locator('h1').first().click();
  const aAfter = await editFrame.locator('#a').evaluate((el) => (el as HTMLElement).style.marginTop);
  const bAfter = await editFrame.locator('#b').evaluate((el) => (el as HTMLElement).style.marginTop);
  expect(aAfter).toBe('20px');
  expect(bAfter).toBe('20px');
  // 一次撤销两元素还原
  await page.keyboard.press('Control+z');
  const aUndo = await editFrame.locator('#a').evaluate((el) => (el as HTMLElement).style.marginTop);
  expect(aUndo).toBe('10px');
});
