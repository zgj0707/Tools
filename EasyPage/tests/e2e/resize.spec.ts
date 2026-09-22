import { expect, test } from '@playwright/test';

// T106 8 向缩放手柄：拖 se 手柄放大、撤销还原、缩小到 < MIN_BOX_PX 被钳制。
// 真实鼠标 down/move 在本环境会挂起，故用浏览器内合成 PointerEvent 驱动完整接线。
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>T106 缩放</title>
<style>.card{border:1px solid #333;margin:40px;user-select:none;box-sizing:border-box}</style></head>
<body>
  <div class="card" style="width:120px;height:80px">卡片</div>
</body>
</html>`;

async function dragHandle(page: import('@playwright/test').Page, dir: string, dx: number, dy: number) {
  const handle = page.locator(`#ep-overlay-root [data-dir="${dir}"]`);
  await handle.evaluate(
    (h, { dx, dy }) => {
      const rect = h.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      h.dispatchEvent(
        new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }),
      );
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: cx + dx, clientY: cy + dy, bubbles: true }),
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: cx + dx, clientY: cy + dy, bubbles: true }),
      );
    },
    { dx, dy },
  );
}

test('缩放：拖 se 手柄放大、撤销还原、缩小钳制到 MIN_BOX_PX', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const card = editFrame.locator('.card');
  const rect = () => card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });

  // 选中卡片 → 出现 se 手柄
  await card.click();
  await expect(page.locator('#ep-overlay-root [data-dir="se"]')).toBeVisible();

  const start = await rect();

  // 拖 se 手柄向右下 +80/+60（border-box 尺寸应增加约 80/60）
  await dragHandle(page, 'se', 80, 60);
  const grown = await rect();
  expect(grown.w - start.w).toBe(80);
  expect(grown.h - start.h).toBe(60);

  // 撤销还原到起始尺寸
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  expect(await rect()).toEqual(start);

  // 再选中，拖 se 手柄向内缩小到 < MIN_BOX_PX（16），应被钳制
  await card.click();
  await dragHandle(page, 'se', -300, -300);
  const after = await rect();
  expect(after.w).toBeGreaterThanOrEqual(16);
  expect(after.h).toBeGreaterThanOrEqual(16);
});

test('无损：百分比元素选中后手柄隐藏，导出仍保留百分比不被强转 px', async ({ page }) => {
  const pctFixture = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>pct</title></head>
<body>
  <div class="pct" style="width:50%;height:80px">百分比块</div>
</body>
</html>`;
  await page.goto('/');
  await page.locator('textarea').fill(pctFixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const pct = editFrame.locator('.pct');
  await pct.click();

  // 不可缩放 → 8 手柄隐藏，但选中框仍在
  await expect(page.locator('#ep-overlay-root [data-dir="se"]')).toBeHidden();
  await expect(page.locator('#ep-selected-box')).toBeVisible();

  // 导出：下载 HTML 中该元素仍为 50%，未被强转 px
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 HTML' }).click(),
  ]);
  const stream = await download.createReadStream();
  let html = '';
  for await (const chunk of stream as unknown as AsyncIterable<{ toString(): string }>) {
    html += chunk.toString();
  }
  expect(html).toContain('width:50%');
  expect(html).not.toMatch(/style="[^"]*width:\s*\d+px/);
});

// 2026-09-22 回归：单击手柄（down→up 之间没有任何 move）不该入历史。
// 修复前 up() 无条件 push ResizeCommand，撤销一步只退掉这个"幽灵"命令，
// 用户看到的现象是「按一次 Ctrl+Z 毫无变化」。
test('缩放：单击手柄不拖动不占用撤销步', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const card = editFrame.locator('.card');
  const transform = () => card.evaluate((el) => (el as HTMLElement).style.transform);

  // 真实编辑：方向键微移一步（入一条 MoveCommand）
  await card.click();
  await page.keyboard.press('ArrowRight');
  expect(await transform()).toContain('translate');

  // 单击 se 手柄，但绝不派发 pointermove
  await page.locator('#ep-overlay-root [data-dir="se"]').evaluate((h) => {
    const r = h.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    h.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true }),
    );
  });

  // 撤销一次必须退掉位移，而不是退掉一个幽灵 ResizeCommand
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+z');
  expect(await transform()).not.toContain('translate');
});
