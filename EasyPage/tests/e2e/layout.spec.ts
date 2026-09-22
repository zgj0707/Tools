import { expect, test } from '@playwright/test';

// T121 布局层（方案 C · Canvas First）：左右面板默认收起、按需滑出并持久化；
// 导入浮层的空状态引导；面包屑画布底部浮动胶囊。
//
// 本文件刻意退出全局 storageState（见 playwright.config.ts）：全局前置条件是
// 「面板已展开」，而这里要覆盖的正是「默认收起」这一默认态与开关行为。
test.use({ storageState: { cookies: [], origins: [] } });

const fixture = `<!DOCTYPE html><body><p id="p1">hi</p></body>`;

const LEFT_TOGGLE = '插入与图层';
const RIGHT_TOGGLE = '样式';

test('默认收起：左右面板均不可见，根节点状态为 closed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('aside.ep-elements')).toBeHidden();
  await expect(page.locator('aside.ep-layers')).toBeHidden();
  await expect(page.locator('aside.ep-panel')).toBeHidden();
  await expect(page.locator('#ep-app')).toHaveAttribute('data-left', 'closed');
  await expect(page.locator('#ep-app')).toHaveAttribute('data-right', 'closed');
});

test('顶栏开关：展开左右面板 → aria-pressed 翻转 → reload 后仍展开', async ({ page }) => {
  await page.goto('/');
  const right = page.getByRole('button', { name: RIGHT_TOGGLE });
  const left = page.getByRole('button', { name: LEFT_TOGGLE });
  await expect(right).toHaveAttribute('aria-pressed', 'false');

  await right.click();
  await expect(page.locator('aside.ep-panel')).toBeVisible();
  await expect(page.locator('#ep-app')).toHaveAttribute('data-right', 'open');
  await expect(right).toHaveAttribute('aria-pressed', 'true');

  await left.click();
  await expect(page.locator('aside.ep-elements')).toBeVisible();
  await expect(page.locator('aside.ep-layers')).toBeVisible();
  await expect(page.locator('#ep-app')).toHaveAttribute('data-left', 'open');

  // 持久化：面板开合是用户偏好，跨会话记忆
  await page.reload();
  await expect(page.locator('aside.ep-panel')).toBeVisible();
  await expect(page.locator('aside.ep-elements')).toBeVisible();
  await expect(page.locator('aside.ep-layers')).toBeVisible();

  // 再点一次收起，并确认收起态同样被记住
  await right.click();
  await expect(page.locator('aside.ep-panel')).toBeHidden();
  await page.reload();
  await expect(page.locator('aside.ep-panel')).toBeHidden();
});

test('画布优先：收起面板后画布显著变宽', async ({ page }) => {
  await page.goto('/');
  const frame = page.locator('#ep-canvas-frame');
  const closedWidth = (await frame.boundingBox())!.width;

  await page.getByRole('button', { name: LEFT_TOGGLE }).click();
  await page.getByRole('button', { name: RIGHT_TOGGLE }).click();
  const openWidth = (await frame.boundingBox())!.width;

  // 面板总宽 160 + 200 + 220 = 580px，全部收起后应归还给画布
  expect(closedWidth).toBeGreaterThan(openWidth + 300);
  expect(closedWidth).toBeGreaterThan(1000);
});

test('对齐条：贴在画布上沿的浮动词条（左对齐、位于画布之上）', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const bar = (await page.locator('.ep-alignbar').boundingBox())!;
  const frame = (await page.locator('#ep-canvas-frame').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(frame.y + 1);
  expect(Math.abs(bar.x - frame.x)).toBeLessThan(2);
});

test('导入浮层：空状态可见 → 导入成功后收起 → 「粘贴 HTML」可再唤起', async ({ page }) => {
  await page.goto('/');
  const overlay = page.locator('.ep-import-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#ep-draft-row')).toHaveText('无草稿');

  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.frameLocator('#ep-canvas-frame').locator('#p1')).toHaveText('hi');

  // 有文档后的二次导入必须经顶栏「粘贴 HTML」唤起浮层
  await page.getByRole('button', { name: '粘贴 HTML' }).click();
  await expect(overlay).toBeVisible();
  await page.locator('textarea').fill('<!DOCTYPE html><body><h2 id="t2">second</h2></body>');
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.frameLocator('#ep-canvas-frame').locator('#t2')).toHaveText('second');
});

test('导入空内容：浮层保持可见，仅提示', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill('');
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await expect(page.locator('.ep-toast')).toBeVisible();
  await expect(page.locator('.ep-import-overlay')).toBeVisible();
});

test('面包屑胶囊：无选中不占位，选中后浮现在画布下沿', async ({ page }) => {
  await page.goto('/');
  const crumb = page.locator('#ep-breadcrumb');
  await expect(crumb).toBeHidden();

  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.frameLocator('#ep-canvas-frame').locator('#p1').click();

  await expect(crumb).toBeVisible();
  await expect(crumb.locator('span', { hasText: 'p#p1' })).toBeVisible();
  // 胶囊在画布下沿之后（文档流内，不遮画布）
  const pill = (await crumb.boundingBox())!;
  const frame = (await page.locator('#ep-canvas-frame').boundingBox())!;
  expect(pill.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
});
