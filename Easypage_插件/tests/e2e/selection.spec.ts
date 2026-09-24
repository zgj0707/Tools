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

// T123 回归：hover 高亮曾给整页套一圈 2px 蓝框 + 12% 蓝填充（用户报「蓝色框非常影响使用」）。
// 成因三条：① 悬停空白区命中的是 html/body，框 = 整页；② 12% 填充铺满整页盖住内容；
//          ③ 指针离开画布后高亮框不撤，移到顶栏调样式时一直挡着画布。
// 批次 1 · R3 改写（意图不变）：原为 `section.hero{min-height:520px}`。
//
// 那是个**与画布高度耦合**的数字：R3 让画布高度自适应视口后，1280×720 下画布恰为
// 520px，"section 之下还留着空白"这一前提被抹平了（section 正好铺满整屏），
// 于是断言①"悬停画布底部空白不出高亮框"必然失败 —— 但失败的根因是 fixture 的
// 前提失效，不是产品行为变了：把指针移到真正的内容外空白区，高亮依然不出。
//
// 改用 70vh 表达「大型容器 = 画布的 70%」：vh/百分比在 iframe 内按**画布视口**解析，
// 于是无论画布多高，section 恒占 70%（> HOVER_FILL_MAX_RATIO 25% ⇒ 只描边不填充，
// 断言④成立），其下方恒留 30% 空白（断言①成立）。与画布高度彻底解耦。
const t123Fixture = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>T123 hover</title>
<style>html,body{margin:0;padding:0}section.hero{min-height:70vh}</style></head>
<body>
  <section class="hero"><h1>主标题</h1><p class="desc">描述文字</p></section>
</body>
</html>`;

test('hover 高亮：文档根不套框 / 大容器只描边 / 离开画布即撤（T123）', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea').fill(t123Fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();

  const editFrame = page.frameLocator('#ep-canvas-frame');
  const hoverBox = page.locator('#ep-hover-box');
  const frameRect = await page.locator('#ep-canvas-frame').boundingBox();
  expect(frameRect).not.toBeNull();
  const fr = frameRect!;

  // ① 悬停画布底部空白（section 之下 → 命中 html/body）→ 不出高亮框
  await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height - 20);
  await page.waitForTimeout(200);
  await expect(hoverBox).toBeHidden();

  // ② 悬停小元素（<p>，约占画布 3%）→ 出现高亮且带填充（保留嵌套辨识能力）
  const pBox = await editFrame.locator('p.desc').boundingBox();
  expect(pBox).not.toBeNull();
  await page.mouse.move(pBox!.x + pBox!.width / 2, pBox!.y + pBox!.height / 2);
  await page.waitForTimeout(200);
  await expect(hoverBox).toBeVisible();
  await expect(hoverBox).toHaveAttribute('data-fill', 'true');

  // ③ 指针移出画布（顶栏）→ 高亮立刻撤掉，不再滞留挡画布
  await page.mouse.move(fr.x + fr.width / 2, 20);
  await page.waitForTimeout(200);
  await expect(hoverBox).toBeHidden();

  // ④ 悬停大容器（section，约占画布 70%）→ 仍描边但数据标记为「不填充」
  // 探测点取画布高度的 35%（而非固定的 +300px）：R3 后画布高度随视口变，
  // 固定偏移会在矮视口下落到 section 之外，让这条断言变成对环境的依赖。
  await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height * 0.35);
  await page.waitForTimeout(200);
  await expect(hoverBox).toBeVisible();
  await expect(hoverBox).toHaveAttribute('data-fill', 'false');
  const bg = await hoverBox.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
});
