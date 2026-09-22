import { expect, test } from '@playwright/test';

const fixture = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><h2 id="t1">标题1</h2><div id="box"><p id="p1">段落一</p><p id="p2">段落二</p></div></body></html>`;

test('图层：点击选中；隐藏 display:none；撤销还原', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-layers');

  await panel.locator('.ep-layer-row', { hasText: 'p#p1' }).click();
  await expect(editFrame.locator('#p1')).toBeVisible();

  // 隐藏：行内第 5 个按钮（↑top ↑ ↓ ↓bottom 之后是 lock，再后是 hide）
  const row = panel.locator('.ep-layer-row', { hasText: 'p#p1' });
  await row.locator('button', { hasText: '👁' }).click();
  await expect(editFrame.locator('#p1')).toHaveCSS('display', 'none');

  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('#p1')).not.toHaveCSS('display', 'none');
});

test('图层：reorder 下移改变顺序；首行上移 disabled；撤销还原', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-layers');

  // box 内 p1 在 p2 前。下移 p1 → p1 变第 2
  const p1row = panel.locator('.ep-layer-row', { hasText: 'p#p1' });
  // 首行（box 内第一）上移 disabled
  await expect(p1row.locator('button[data-dir="-1"]')).toBeDisabled();
  // 下移按钮
  await p1row.locator('button[data-dir="1"]').click();
  await expect(editFrame.locator('#box').locator('p').nth(0)).toHaveId('p2');
  await expect(editFrame.locator('#box').locator('p').nth(1)).toHaveId('p1');

  // 撤销
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  await expect(editFrame.locator('#box').locator('p').nth(0)).toHaveId('p1');
});

test('图层：画布点元素→树行高亮；折叠开关', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-layers');

  // 画布点击
  await editFrame.locator('#p2').click();
  const p2row = panel.locator('.ep-layer-row', { hasText: 'p#p2' });
  await expect(p2row).toHaveCSS('background-color', 'rgb(219, 234, 254)');

  // 折叠 box：点 ▾ 开关
  const boxRow = panel.locator('.ep-layer-row', { hasText: 'div#box' });
  await boxRow.locator('.ep-layer-toggle').click();
  await expect(panel.locator('.ep-layer-row', { hasText: 'p#p1' })).toHaveCount(0);
  // 再展开
  await boxRow.locator('.ep-layer-toggle').click();
  await expect(panel.locator('.ep-layer-row', { hasText: 'p#p1' })).toHaveCount(1);
});

test('图层：锁定后拖拽无 translate、删除拦截、双击不进编辑、导出无 lock', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const panel = page.locator('aside.ep-layers');

  // 锁定 p1：点行内 lock 按钮（🔓）
  const p1row = panel.locator('.ep-layer-row', { hasText: 'p#p1' });
  await p1row.locator('button', { hasText: '🔓' }).click();
  await expect(p1row.locator('button', { hasText: '🔒' })).toHaveCount(1);

  // 选中 p1（点行名）
  await p1row.locator('span').nth(1).click();

  // 锁定：删除被拦截（elements 面板删除按钮）
  await page.locator('aside.ep-elements button', { hasText: '删除' }).click();
  await expect(editFrame.locator('#p1')).toHaveCount(1);

  // 锁定：合成拖拽（参照 drag.spec.ts），transform 不产生 translate
  const before = await editFrame.locator('#p1').evaluate((el) => (el as HTMLElement).style.transform);
  await editFrame.locator('#p1').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const doc = el.ownerDocument;
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 5, clientY: rect.top + 5, bubbles: true }));
    doc.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 80, clientY: rect.top + 80, bubbles: true }));
    doc.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + 80, clientY: rect.top + 80, bubbles: true }));
  });
  const after = await editFrame.locator('#p1').evaluate((el) => (el as HTMLElement).style.transform);
  expect(after).toBe(before);
  // 锁定：双击不进入就地编辑
  await editFrame.locator('#p1').dblclick();
  await expect(editFrame.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(editFrame.locator('[data-ep-editing]')).toHaveCount(0);
  // 锁定：外壳 8 向手柄隐藏
  await expect(page.locator('#ep-overlay-root [data-dir]').first()).toHaveCSS('display', 'none');
  // 锁定态纯内存：被编辑 doc 中无 data-lock
  const attrs = await editFrame.locator('#p1').evaluate((el) => el.getAttributeNames());
  expect(attrs.some((a) => a.startsWith('data-lock'))).toBe(false);
});

test('图层：15000 节点懒渲染不卡死、首屏行数有界', async ({ page }) => {
  // 程序化生成 15000 个 p 平铺在 body
  let html = '<!DOCTYPE html><html><body>';
  for (let i = 0; i < 15000; i++) html += `<p id=n${i}>n${i}</p>`;
  html += '</body></html>';
  await page.goto('/');
  await page.locator('textarea').fill(html);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const panel = page.locator('aside.ep-layers');
  await expect(panel.locator('.ep-layer-row')).toHaveCount(200, { timeout: 5000 });
  // 显示更多按钮存在
  await expect(panel.locator('.ep-layer-more')).toHaveCount(1);
  // 点显示更多 → 行数增加到 400
  await panel.locator('.ep-layer-more').click();
  await expect(panel.locator('.ep-layer-row')).toHaveCount(400, { timeout: 5000 });
});
