import { expect, test } from '@playwright/test';

// T103 覆盖层：hover 高亮 / 选中框 / 面包屑 / 滚动贴合 / 点空白清空
const fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>T103 选中</title>
<style>body{padding:40px}</style></head>
<body>
  <div id="page">
    <section class="hero">
      <h1>主标题</h1>
      <p class="desc">这是一段描述文字</p>
    </section>
    <div class="spacer">
      <p>段落 A</p><p>段落 B</p><p>段落 C</p><p>段落 D</p>
      <p>段落 E</p><p>段落 F</p><p>段落 G</p><p>段落 H</p>
      <p>段落 I</p><p>段落 J</p><p>段落 K</p><p>段落 L</p>
    </div>
  </div>
</body>
</html>`;

test('覆盖层：点击选中框 / hover 高亮 / 滚动贴合 / 面包屑选父 / 点空白清空', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const selectedBox = page.locator('#ep-selected-box');
  const hoverBox = page.locator('#ep-hover-box');

  // 1. 点击描述段落 → 出现选中框
  await editFrame.locator('p.desc').click();
  await expect(selectedBox).toBeVisible();

  // 选中框与元素位置贴合
  const pBox = await editFrame.locator('p.desc').boundingBox();
  const selBox = await selectedBox.boundingBox();
  expect(pBox).not.toBeNull();
  expect(selBox).not.toBeNull();
  expect(Math.abs((selBox?.x ?? 0) - (pBox?.x ?? 0))).toBeLessThan(3);
  expect(Math.abs((selBox?.y ?? 0) - (pBox?.y ?? 0))).toBeLessThan(3);

  // 2. hover 标题 → 出现高亮框
  await editFrame.locator('h1').hover();
  await expect(hoverBox).toBeVisible();

  // 3. 在编辑帧内滚动 → 选中框仍跟随元素
  await editFrame.locator('.spacer p').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const pBoxAfter = await editFrame.locator('p.desc').boundingBox();
  const selBoxAfter = await selectedBox.boundingBox();
  expect(selBoxAfter).not.toBeNull();
  // 滚动后元素移出视口，选中框应随元素位置（可能在视口上方，top 为负或很小）
  expect(Math.abs((selBoxAfter?.x ?? 0) - (pBoxAfter?.x ?? 0))).toBeLessThan(3);

  // 4. 面包屑显示层级，点击 section 选父级
  await editFrame.locator('p.desc').click();
  const crumb = page.locator('#ep-breadcrumb span', { hasText: 'section' });
  await expect(crumb).toBeVisible();
  await crumb.click();
  await page.waitForTimeout(150);
  // 选中框随 section 变大
  const sectionBox = await editFrame.locator('section.hero').boundingBox();
  const selOnSection = await selectedBox.boundingBox();
  expect(Math.abs((selOnSection?.y ?? 0) - (sectionBox?.y ?? 0))).toBeLessThan(3);

  // 5. 点编辑帧空白处（body）→ 清空选中
  await editFrame.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(selectedBox).not.toBeVisible();
});
