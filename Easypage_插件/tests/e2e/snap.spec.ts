import { expect, test } from '@playwright/test';

// T107 对齐吸附：拖第二张卡片接近与第一张左对齐时出现吸附线，远离则消失。
// 真实鼠标 down/move 在本环境挂起，用合成 PointerEvent；吸附线在拖拽中（up 前）观察。
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>T107 吸附</title>
<style>
  .card1{position:absolute;left:0;top:0;width:100px;height:80px;box-sizing:border-box;border:1px solid #333}
  .card2{position:absolute;left:200px;top:0;width:100px;height:80px;box-sizing:border-box;border:1px solid #333}
</style></head>
<body>
  <div class="card1">A</div>
  <div class="card2">B</div>
</body>
</html>`;

test('拖拽临近对齐出现吸附线，远离消失', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const card2 = editFrame.locator('.card2');
  const guides = page.locator('#ep-overlay-root [data-guide]');

  await card2.click();

  const box = await card2.boundingBox();
  const startX = box!.x + 5;
  const startY = box!.y + 5;

  const down = () =>
    card2.evaluate(
      (el, { sx, sy }) => {
        el.dispatchEvent(new PointerEvent('pointerdown', { clientX: sx, clientY: sy, bubbles: true }));
      },
      { sx: startX, sy: startY },
    );
  const moveTo = (cx: number, cy: number) =>
    editFrame.locator('body').evaluate(
      (doc, { cx, cy }) => {
        doc.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }));
      },
      { cx, cy },
    );

  await down();
  // 拖向左对齐 card1：card2 原 left=200，拖左 200 → left≈0 与 card1 对齐 → 出现吸附线
  await moveTo(startX - 200, startY);
  await expect.poll(async () => await guides.count()).toBeGreaterThan(0);

  // 斜向远离（x、y 都偏移），left/top 均不再对齐，吸附线消失
  await moveTo(startX + 400, startY + 200);
  await expect.poll(async () => await guides.count()).toBe(0);

  await moveTo(startX, startY);
});
