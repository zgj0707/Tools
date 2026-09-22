import { expect, test } from '@playwright/test';

// T110 格式刷：A 刷到 B、C → 关键视觉一致；连续涂抹一次 Ctrl+Z 全部还原
const fixture = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body>
  <div id="A" style="background-color:rgb(220,38,38);color:white;border:3px solid rgb(0,0,0);border-radius:9px;padding:11px">源A</div>
  <div id="B">目标B</div>
  <div id="C">目标C</div>
</body>
</html>`;

test('格式刷：连续涂抹 B/C 一次撤销全部还原', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const A = editFrame.locator('#A');
  const B = editFrame.locator('#B');
  const C = editFrame.locator('#C');

  // 探针：Chromium 上 computed 简写实际值
  const probe = await A.evaluate((el) => {
    const cs = (el.ownerDocument.defaultView as Window).getComputedStyle(el);
    return { padding: cs.padding, border: cs.border, borderRadius: cs.borderRadius };
  });
  console.log('SHORTHAND_PROBE=', JSON.stringify(probe));

  // 选中源 A
  await A.click();
  // 双击按钮 = 连续模式
  await page.getByRole('button', { name: '格式刷' }).dblclick();
  // 涂抹 B、C（合成 pointerdown，避免真实点击导航）
  await B.dispatchEvent('pointerdown');
  await C.dispatchEvent('pointerdown');
  // Esc 退出连续模式（聚合入栈）
  await page.locator('h1').first().click();
  await page.keyboard.press('Escape');

  // B/C 背景色与 A 一致
  await expect(B).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(C).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  // 边框/圆角/内边距与源一致
  await expect(B).toHaveCSS('border-top-width', '3px');
  await expect(B).toHaveCSS('border-top-style', 'solid');
  await expect(B).toHaveCSS('border-top-left-radius', '9px');
  await expect(B).toHaveCSS('padding-top', '11px');
  await expect(C).toHaveCSS('border-top-width', '3px');
  await expect(C).toHaveCSS('border-top-left-radius', '9px');

  // 一次 Ctrl+Z 全部还原
  await page.keyboard.press('Control+z');
  await expect(B).not.toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(B).not.toHaveCSS('border-top-width', '3px');
  await expect(B).not.toHaveCSS('padding-top', '11px');
  await expect(C).not.toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(C).not.toHaveCSS('border-top-left-radius', '9px');
});
