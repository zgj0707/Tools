import { expect, test } from '@playwright/test';

// T105 拖拽微移：合成 PointerEvent 驱动完整接线（适配→MoveCommand→历史）。
// 真实鼠标 down/move 跨 iframe 在本环境会挂起，故用浏览器内 dispatch 确定性验证。
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>T105 拖拽</title>
<style>.card{width:120px;height:80px;border:1px solid #333;margin:40px;user-select:none}</style></head>
<body>
  <div class="card">卡片标题</div>
</body>
</html>`;

test('拖拽：拖动产生 translate、撤销归零、方向键微移、重置', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const card = editFrame.locator('.card');
  const transform = () => card.evaluate((el) => (el as HTMLElement).style.transform);

  // 选中卡片（pointerdown 选中 → attach 拖拽适配器）
  await card.click();

  // 合成一次完整拖拽：从左上角边缘(5px内) 到右下 (55,35)
  await card.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const doc = el.ownerDocument;
    const down = new PointerEvent('pointerdown', {
      clientX: rect.left + 5,
      clientY: rect.top + 5,
      bubbles: true,
    });
    el.dispatchEvent(down);
    doc.dispatchEvent(
      new PointerEvent('pointermove', { clientX: rect.left + 55, clientY: rect.top + 35, bubbles: true }),
    );
    doc.dispatchEvent(
      new PointerEvent('pointerup', { clientX: rect.left + 55, clientY: rect.top + 35, bubbles: true }),
    );
  });
  expect(await transform()).toContain('translate(50px, 30px)');

  // 撤销归零，重做还原
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  expect(await transform()).toBe('');
  await page.keyboard.press('Control+Shift+z');
  expect(await transform()).toContain('translate(50px, 30px)');

  // 方向键微移（ArrowRight=1px），合并到既有 translate
  await card.click();
  await page.locator('h1').first().click();
  await page.keyboard.press('ArrowRight');
  expect(await transform()).toContain('translate(51px, 30px)');

  // 重置位移，回文档流
  await page.getByRole('button', { name: '重置位移' }).click();
  expect(await transform()).toBe('');
});
