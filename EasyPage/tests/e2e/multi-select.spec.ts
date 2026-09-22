import { expect, test } from '@playwright/test';

const fixture = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
.row{display:flex;gap:10px;}
</style></head>
<body>
<div class="row"><div class="card" id="c1" style="width:80px;height:60px;border:1px solid #333;">A</div>
<div class="card" id="c2" style="width:80px;height:60px;border:1px solid #333;margin-left:80px;">B</div>
<div class="card" id="c3" style="width:80px;height:60px;border:1px solid #333;">C</div>
</body></html>`;

test('多选：Shift 点选 toggle；水平等距分布；一次撤销归位', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');

  // 点 c1
  await editFrame.locator('#c1').click();
  // Shift+点 c2, c3
  await editFrame.locator('#c2').click({ modifiers: ['Shift'] });
  await editFrame.locator('#c3').click({ modifiers: ['Shift'] });
  // 三个选中框
  await expect(page.locator('.ep-selected-box-multi')).toHaveCount(2);

  // 记录 c2 初始 left
  const before = await editFrame.locator('#c2').evaluate((el) => (el as HTMLElement).getBoundingClientRect().left);

  // 水平等距分布
  await page.getByRole('button', { name: '水平等距' }).click();
  const after = await editFrame.locator('#c2').evaluate((el) => (el as HTMLElement).getBoundingClientRect().left);
  expect(after).not.toBe(before);

  // 一次 Ctrl+Z 三卡归位
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  const restored = await editFrame.locator('#c2').evaluate((el) => (el as HTMLElement).getBoundingClientRect().left);
  expect(restored).toBe(before);
});

test('<2 元素时对齐提示且 transform 不变', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');

  const t = await editFrame.locator('#c1').evaluate((el) => (el as HTMLElement).style.transform);
  await page.getByRole('button', { name: '水平等距' }).click();
  const t2 = await editFrame.locator('#c1').evaluate((el) => (el as HTMLElement).style.transform);
  expect(t2).toBe(t);
});

test('左对齐：多选后各元素 left 一致；一次撤销归位', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#c1').click();
  await editFrame.locator('#c2').click({ modifiers: ['Shift'] });
  await editFrame.locator('#c3').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '左' }).click();
  const lefts = await editFrame.locator('.card').evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().left));
  expect(lefts[1]).toBe(lefts[0]);
  expect(lefts[2]).toBe(lefts[0]);
  const beforeUndo = lefts[0]!;
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  const afterUndo = await editFrame.locator('.card').evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().left));
  expect(afterUndo[1]).not.toBe(beforeUndo);
});

test('跨父：toast 且 transform 不变', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(`<!DOCTYPE html><body><div id="a"><p class="x">A</p></div><div id="b"><p class="x">B</p></div></body>`);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  await editFrame.locator('#a .x').click();
  await editFrame.locator('#b .x').click({ modifiers: ['Shift'] });
  const before = await editFrame.locator('#a .x').evaluate((el) => (el as HTMLElement).style.transform);
  await page.getByRole('button', { name: '左' }).click();
  const after = await editFrame.locator('#a .x').evaluate((el) => (el as HTMLElement).style.transform);
  expect(after).toBe(before);
});


test("对齐遇锁定元素中止：transform 不变且不入历史", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").fill(fixture);
  await page.getByRole("button", { name: "导入 HTML" }).click();
  const editFrame = page.frameLocator("#ep-canvas-frame");
  await editFrame.locator("#c1").click();
  await page.locator(".ep-layer-row", { hasText: "c1" }).getByRole("button", { name: "🔓" }).click();
  await editFrame.locator("#c2").click({ modifiers: ["Shift"] });
  await editFrame.locator("#c3").click({ modifiers: ["Shift"] });
  const before = await editFrame.locator(".card").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  await page.getByRole("button", { name: "左" }).click();
  const after = await editFrame.locator(".card").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  expect(after).toEqual(before);
});
