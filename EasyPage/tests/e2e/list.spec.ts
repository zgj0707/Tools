import { expect, test } from '@playwright/test';

// T111b 列表互转
const fixture = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><p id="a">文本A</p><p id="b">文本B</p><div id="box">容器</div></body></html>`;

test('P → ul → 撤销/重做 → 取消列表', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');

  await editFrame.locator('#a').click();
  await panel.getByRole('button', { name: '项目符号列表' }).click();
  await expect(editFrame.locator('ul')).toHaveCount(1);
  await expect(editFrame.locator('li')).toHaveText('文本A');
  await expect(editFrame.locator('p#a')).toHaveCount(0);

  // 撤销还原 p
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('ul')).toHaveCount(0);
  await expect(editFrame.locator('p#a')).toHaveText('文本A');

  // 重做恢复 ul
  await page.keyboard.press('Control+Shift+z');
  await expect(editFrame.locator('ul')).toHaveCount(1);

  // 取消列表
  await editFrame.locator('ul').dispatchEvent('pointerdown');
  await panel.getByRole('button', { name: /取消列表|项目符号列表/ }).first().click();
  await expect(editFrame.locator('ul')).toHaveCount(0);
  await expect(editFrame.locator('body > p').nth(0)).toHaveText('文本A');
});

test('编号列表 ol；容器不可转', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');

  await editFrame.locator('#b').click();
  await panel.getByRole('button', { name: '编号列表' }).click();
  await expect(editFrame.locator('ol')).toHaveCount(1);
  await expect(editFrame.locator('li')).toHaveText('文本B');
});

test('取消列表：中间位置 undo 还原位置；嵌套/容器不改 DOM', async ({ page }) => {
  const f = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><p id="a">A</p><ul id="u"><li>B</li></ul><p id="c">C</p>
<div id="box">容器</div>
<ul id="nest"><li>x<ul><li>y</li></ul></li></ul></body></html>`;
  await page.goto('/');
  await page.locator('textarea').fill(f);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');

  await editFrame.locator('#u').dispatchEvent('pointerdown');
  await panel.getByRole('button', { name: /取消列表|项目符号列表/ }).first().click();
  await expect(editFrame.locator('body > p').nth(0)).toHaveText('A');
  await expect(editFrame.locator('body > p').nth(1)).toHaveText('B');
  await expect(editFrame.locator('body > p').nth(2)).toHaveText('C');

  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('#u')).toHaveCount(1);
  await expect(editFrame.locator('#a').locator('xpath=following-sibling::*[1]')).toHaveId('u');
  await expect(editFrame.locator('#u').locator('xpath=following-sibling::*[1]')).toHaveId('c');
});

test('列表按钮随选中刷新：容器/嵌套/table 内 disabled 且 DOM 不变', async ({ page }) => {
  const f = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><p id="p">普通</p><div id="box">容器</div>
<ul id="nest"><li>x<ul><li>y</li></ul></li></ul>
<table><tr><td><p id="tp">表格内</p></td></tr></table></body></html>`;
  await page.goto('/');
  await page.locator('textarea').fill(f);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-elements');
  const ulBtn = panel.getByRole('button', { name: /项目符号列表|取消列表/ }).first();
  const olBtn = panel.getByRole('button', { name: /编号列表|取消列表/ }).last();

  // 普通 p 启用
  await editFrame.locator('#p').dispatchEvent('pointerdown');
  await expect(ulBtn).toBeEnabled();
  await expect(olBtn).toBeEnabled();

  // 容器 div disabled
  await editFrame.locator('#box').dispatchEvent('pointerdown');
  await expect(ulBtn).toBeDisabled();
  await expect(olBtn).toBeDisabled();

  // 嵌套 ul disabled
  await editFrame.locator('#nest').dispatchEvent('pointerdown');
  await expect(ulBtn).toBeDisabled();

  // table 内 disabled 且 DOM 不变
  const before = await editFrame.locator('table').evaluate((el) => el.outerHTML);
  await editFrame.locator('#tp').dispatchEvent('pointerdown');
  await expect(ulBtn).toBeDisabled();
  await expect(await editFrame.locator('table').evaluate((el) => el.outerHTML)).toBe(before);
});
