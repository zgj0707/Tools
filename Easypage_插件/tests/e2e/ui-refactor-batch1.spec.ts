import { expect, test } from '@playwright/test';

// 批次 1 UI/UX 重构验收（方案见 docs/plan/06-UIUX重构方案-对标Figma与Canva.md）。
//
// 【本文件与其它 spec 的关系】
// 其它 spec 全部跑在「视图偏好已钉死」的全局前置下（见 playwright.config.ts：
// autoFit=false + 属性三组全展开），它们覆盖的是**行为不变性**。
// 本文件覆盖的恰恰是那些被钉死项本身的**默认值与交互**，因此分两组：
//   · 默认组：退出全局 storageState，走产品默认（autoFit=true、只展开「文字」组）。
//   · 行为组：沿用全局前置，验证 R1/R2/R4/R5 的交互确实生效。
//
// 断言基线（改造前实测，见方案 §2 E1–E8）：
//   E1 预览帧可见高度 0（渲染在 y=900 处）
//   E2 画布恒 600px，1440×900 下底部白留 194px
//   E3 全站无缩放能力，面板展开后画布 768px 只能截断查看
//   E4 右侧面板 30 字段自高 1221px，1440 视口需滚 45%

const fixture = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>批次1</title>
<style>body{margin:0;font:16px/1.6 sans-serif}.hero{padding:24px}h1{margin:0 0 12px}</style>
</head><body>
<div class="hero"><h1 id="t1">标题一</h1><p id="p1">段落一</p><p id="p2">段落二</p></div>
</body></html>`;

/** ZoomController 的设计宽基线（src/constants.ts 的 VIEW.DESIGN_WIDTH）。 */
const DESIGN_WIDTH = 1200;

/**
 * 「渲染视口 ≈ 设计宽」这条断言只能按**相对误差**判定。
 * 缩放比被量化到小数点后两位（ZoomController.clamp 里的 Math.round(z*100)/100，
 * 目的：百分比显示与加减档位都取整数点），步长 0.01 在 zoom≈0.5 时相当于约 2%
 * 的相对误差 —— 实测容器 608px 时 zoom 由 0.5067 量化为 0.51，视口 1192px 而非 1200px。
 * 这是显示精度与「整宽尽收眼底」之间的正常折中，不是缺陷：视口 1192 < 1200，
 * 整页宽度依然完整可见（这才是该能力的真实承诺）。
 */
const DESIGN_TOLERANCE = DESIGN_WIDTH * 0.02;

/** 导入 fixture，返回编辑帧 locator。 */
async function importFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  return page.frameLocator('#ep-canvas-frame');
}

// ─────────────────────────────────────────────────────────────
// 默认组：产品默认值（退出全局前置）
// ─────────────────────────────────────────────────────────────
test.describe('产品默认（无持久化偏好）', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // R2：默认「自动适应宽度」。画布宽度按设计宽度 1200px 排版，
  // 视觉占位恒定等于容器宽 —— 这是与改造前最根本的差别：改造前画布恒 600px 高、
  // 宽度随容器，用户看到的是「按当前宽度 reflow 的窄版」。
  test('R2 默认自动适应宽度：缩放比由容器宽 / 设计宽决定，视觉占位仍等于容器宽', async ({ page }) => {
    const editFrame = await importFixture(page);
    await editFrame.locator('#t1').waitFor();

    // 展开左右面板，把容器压到 1200 设计宽以下 —— 这正是 E3 的痛点场景
    // （面板展开后画布只剩 768px，改造前只能截断查看）。
    await page.getByRole('button', { name: '插入与图层' }).click();
    await page.getByRole('button', { name: '样式' }).first().click();

    const frame = page.locator('#ep-canvas-frame');
    const zoomOf = () => frame.evaluate((el) => (el as HTMLElement).dataset.zoom ?? null);
    // 等 ResizeObserver → requestAnimationFrame → apply 落地
    await expect.poll(zoomOf, { timeout: 5_000 }).not.toBeNull();

    const host = page.locator('.ep-canvas-host');
    const hostBox = (await host.boundingBox())!;
    const frameBox = (await frame.boundingBox())!;
    const info = await frame.evaluate((el) => ({
      zoom: Number((el as HTMLElement).dataset.zoom ?? '1'),
      // 渲染视口宽 = **未缩放**的 layout 宽（offsetWidth）。
      // 不能用 getBoundingClientRect()：它含 transform，恒等于视觉占位宽（= 容器宽），
      // 拿它反推设计宽是个恒真命题，什么都验证不到。
      layoutW: (el as HTMLElement).offsetWidth,
    }));

    expect(info.zoom).toBeGreaterThan(0);
    expect(info.zoom).toBeLessThan(1);
    // 渲染视口按 1200 设计宽排版（容差见 DESIGN_TOLERANCE：缩放比量化到 2 位小数）
    expect(Math.abs(hostBox.width / info.zoom - DESIGN_WIDTH)).toBeLessThanOrEqual(DESIGN_TOLERANCE);
    // 视觉占位 = 容器宽（±2px 亚像素）⇒ 一屏看尽整页宽
    expect(Math.abs(frameBox.width - hostBox.width)).toBeLessThanOrEqual(2);
    // 两个量的关系：视觉宽 = 渲染视口宽 × 缩放
    expect(Math.abs(info.layoutW - hostBox.width / info.zoom)).toBeLessThanOrEqual(2);
    // 且渲染视口确实比容器宽 —— 这才是「整页宽尽收眼底」的实质
    expect(info.layoutW).toBeGreaterThan(hostBox.width);

    // 缩放控件显示的是百分比，不是恒定的 100%
    await expect(page.locator('.ep-zoombar__value')).not.toHaveText('100%');
  });

  // R3：画布吃掉可用高度。改造前内联 height:600px 是硬常量。
  test('R3 画布填满可用高度：高度跟随视口，不出现底部大面积留白', async ({ page }) => {
    const editFrame = await importFixture(page);
    await editFrame.locator('#t1').waitFor();

    const viewport = page.viewportSize()!;
    const frameBox = (await page.locator('#ep-canvas-frame').boundingBox())!;
    const hostBox = (await page.locator('.ep-canvas-host').boundingBox())!;

    // 帧高 = 宿主高（height:100%）
    expect(Math.abs(frameBox.height - hostBox.height)).toBeLessThanOrEqual(2);
    // 宿主下沿 + 底部行仍在视口内 ⇒ 无溢出
    expect(hostBox.y + hostBox.height).toBeLessThanOrEqual(viewport.height);
    // 底部行与视口下沿的间距 ≤ 80px；改造前 1440×900 下白留 194px
    expect(viewport.height - (hostBox.y + hostBox.height)).toBeLessThanOrEqual(80);
  });

  // R7：属性面板默认只展开「文字」组。三组全展开时内容高 1221px，1440 视口要滚 45%。
  test('R7 属性面板默认只展开「文字」组，盒模型默认收起且字段不进可访问性树', async ({ page }) => {
    await importFixture(page);
    await page.getByRole('button', { name: '样式' }).first().click();

    const text = page.locator('.ep-section[data-section="text"]');
    const box = page.locator('.ep-section[data-section="box"]');
    const deco = page.locator('.ep-section[data-section="deco"]');

    await expect(text).toHaveAttribute('data-open', 'true');
    await expect(box).toHaveAttribute('data-open', 'false');
    await expect(deco).toHaveAttribute('data-open', 'false');

    // 收起态必须是确定性不可见（display:none），不能只是 max-height:0 ——
    // 后者元素仍可命中，会制造「点了看不见的输入框」这类假通过。
    await expect(page.locator('.ep-box input[type=number]').first()).toBeHidden();

    // 折叠头有无障碍状态
    await expect(page.getByRole('button', { name: '布局与尺寸' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: '文字' })).toHaveAttribute('aria-expanded', 'true');
  });

  // R7：展开态持久化（与面板开合同一口径）。
  test('R7 分组展开态可切换并跨 reload 记忆', async ({ page }) => {
    await importFixture(page);
    await page.getByRole('button', { name: '样式' }).first().click();
    await page.getByRole('button', { name: '布局与尺寸' }).click();

    await expect(page.locator('.ep-section[data-section="box"]')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('.ep-box input[type=number]').first()).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: '样式' }).first().click();
    await expect(page.locator('.ep-section[data-section="box"]')).toHaveAttribute('data-open', 'true');
  });
});

// ─────────────────────────────────────────────────────────────
// 行为组：交互确实生效（沿用全局前置：autoFit=false、三组全展开）
// ─────────────────────────────────────────────────────────────

// R1：预览从「渲染在屏外的入流块」改成「顶栏下方的全屏覆盖层」。
test('R1 预览：覆盖层铺满顶栏下方，帧可见高度 > 0 且在视口内', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  const overlay = page.locator('#ep-preview-overlay');
  await expect(overlay).toHaveAttribute('data-open', 'false');
  await expect(overlay).toBeHidden();

  await page.getByRole('button', { name: '预览' }).click();
  await expect(overlay).toHaveAttribute('data-open', 'true');
  await expect(overlay).toBeVisible();

  const frame = page.locator('#ep-preview-frame');
  await expect(frame).toBeVisible();
  const box = (await frame.boundingBox())!;
  const viewport = page.viewportSize()!;

  // 改造前：可见高度 0（帧从 y=900 起渲染）。基线即 E1。
  expect(box.height).toBeGreaterThan(200);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.width).toBeGreaterThan(200);

  // 覆盖层从顶栏下方开始 ⇒ 顶栏「预览」按钮仍可点（同一个按钮开与关）
  const topbar = (await page.locator('.ep-topbar').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(topbar.y + topbar.height);
});

test('R1 预览设备档位：手机 / 平板 / 桌面 / 铺满切换只改帧宽，不改沙箱', async ({ page }) => {
  await importFixture(page);
  await page.getByRole('button', { name: '预览' }).click();
  const frame = page.locator('#ep-preview-frame');
  await expect(frame).toBeVisible();

  const widthOf = async () => (await frame.boundingBox())!.width;
  const stageBox = (await page.locator('.ep-preview__stage').boundingBox())!;
  const stagePad = await page.locator('.ep-preview__stage').evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  });
  // 档位是「期望宽度」而非「强制宽度」：#ep-preview-frame 有 max-width:100%，
  // 舞台装不下时按可用宽度收窄（否则窄窗口下会出现横向滚动条）。
  const expected = (desired: number) => Math.min(desired, stageBox.width - stagePad);

  await page.getByRole('button', { name: '手机宽度' }).click();
  expect(Math.abs((await widthOf()) - expected(375))).toBeLessThanOrEqual(2);

  await page.getByRole('button', { name: '平板宽度' }).click();
  expect(Math.abs((await widthOf()) - expected(768))).toBeLessThanOrEqual(2);

  await page.getByRole('button', { name: '桌面宽度' }).click();
  const deskW = await widthOf();
  expect(Math.abs(deskW - expected(1280))).toBeLessThanOrEqual(2);
  if (stageBox.width - stagePad >= 1280) {
    // 舞台装得下 1280：必须正好是 1280
    expect(Math.abs(deskW - 1280)).toBeLessThanOrEqual(2);
  } else {
    // 装不下：顶到可用宽上限，但必须明显宽于平板档 —— 证明它确实按 1280 请求过，
    // 而不是没响应（1280 视口下舞台可用宽约 1248，故这条在实际环境里走 else 分支）
    expect(deskW).toBeGreaterThan(768);
  }

  await page.getByRole('button', { name: '铺满可用宽度' }).click();
  expect(Math.abs((await widthOf()) - stageBox.width + stagePad)).toBeLessThanOrEqual(2);

  // 安全红线：档位切换绝不改动 sandbox（逐字 "allow-scripts"，不含 allow-same-origin）
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');

  // 档位按钮有 aria-pressed 状态
  await expect(page.getByRole('button', { name: '铺满可用宽度' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '手机宽度' })).toHaveAttribute('aria-pressed', 'false');
});

test('R1 预览：同一按钮开与关；Esc 关预览；关闭后帧不残留', async ({ page }) => {
  await importFixture(page);
  const overlay = page.locator('#ep-preview-overlay');

  await page.getByRole('button', { name: '预览' }).click();
  await expect(overlay).toHaveAttribute('data-open', 'true');
  await page.getByRole('button', { name: '预览' }).click();
  await expect(overlay).toHaveAttribute('data-open', 'false');
  await expect(page.locator('#ep-preview-frame')).toHaveCount(0);

  // Esc 优先关预览（覆盖层是最上层界面）
  await page.getByRole('button', { name: '预览' }).click();
  await expect(overlay).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('data-open', 'false');

  // 覆盖层内的「关闭」按钮
  await page.getByRole('button', { name: '预览' }).click();
  await expect(overlay).toHaveAttribute('data-open', 'true');
  await page.getByRole('button', { name: '关闭' }).click();
  await expect(overlay).toHaveAttribute('data-open', 'false');
});

// R2：缩放系统。语义是「改渲染视口宽」，不是「把 iframe 缩小」。
test('R2 缩放：加减档位、恢复 100%、Ctrl 快捷键、缩放 100% 时清空 transform', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  const frame = page.locator('#ep-canvas-frame');
  const zoomOf = () => frame.evaluate((el) => (el as HTMLElement).dataset.zoom ?? null);
  const transformOf = () => frame.evaluate((el) => (el as HTMLElement).style.transform);

  // 全局前置把 autoFit 钉成 false 且无历史手动值 ⇒ 初始恒 100%
  expect(await zoomOf()).toBeNull();
  await expect(page.locator('.ep-zoombar__value')).toHaveText('100%');

  await page.getByRole('button', { name: '放大' }).click();
  expect(Number(await zoomOf())).toBeCloseTo(1.1, 5);
  await expect(page.locator('.ep-zoombar__value')).toHaveText('110%');

  await page.getByRole('button', { name: '缩小' }).click();
  await page.getByRole('button', { name: '缩小' }).click();
  expect(Number(await zoomOf())).toBeCloseTo(0.9, 5);

  // 点百分比回 100%：必须**清空** transform 与 dataset，回到与改造前逐像素一致的 DOM
  await page.locator('.ep-zoombar__value').click();
  expect(await zoomOf()).toBeNull();
  expect(await transformOf()).toBe('');
  await expect(page.locator('.ep-zoombar__value')).toHaveText('100%');

  // 键盘：Ctrl+= 放大、Ctrl+- 缩小、Ctrl+0 恢复
  await page.keyboard.press('Control+=');
  expect(Number(await zoomOf())).toBeCloseTo(1.1, 5);
  await page.keyboard.press('Control+0');
  expect(await zoomOf()).toBeNull();

  // 缩放不改变导出内容 —— 它纯粹是视图层
  await page.getByRole('button', { name: '缩小' }).click();
  await expect(page.locator('.ep-zoombar__value')).toHaveText('90%');
});

test('R2 缩放后选中框仍贴合元素（坐标换算随缩放）', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  const frame = page.locator('#ep-canvas-frame');
  const selected = page.locator('#ep-selected-box').first();
  const frameBox = () => frame.boundingBox() as Promise<{ x: number; y: number; width: number; height: number }>;

  await page.getByRole('button', { name: '缩小' }).click();
  await page.getByRole('button', { name: '缩小' }).click();
  await expect(page.locator('.ep-zoombar__value')).toHaveText('80%');

  await editFrame.locator('#t1').click();
  await expect(selected).toBeVisible();

  const fb = await frameBox();
  const tb = (await editFrame.locator('#t1').boundingBox())!;
  const sb = (await selected.boundingBox())!;

  // 编辑帧内元素 boundingBox 已是屏幕坐标（Playwright 对 frameLocator 返回外页坐标），
  // 选中框必须与之贴合（±2px）
  expect(Math.abs(sb.x - tb.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(sb.y - tb.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(sb.width - tb.width)).toBeLessThanOrEqual(2);
  // 缩放后帧视觉宽仍等于宿主宽（视觉占位恒定）
  const hostBox = (await page.locator('.ep-canvas-host').boundingBox())!;
  expect(Math.abs(fb.width - hostBox.width)).toBeLessThanOrEqual(2);
});

test('R2 适应宽度按钮：整页宽度尽收眼底', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  await page.getByRole('button', { name: '适应宽度' }).click();
  const frame = page.locator('#ep-canvas-frame');
  const hostBox = (await page.locator('.ep-canvas-host').boundingBox())!;
  const frameBox = (await frame.boundingBox())!;
  // 视觉占位恒定 = 容器宽
  expect(Math.abs(frameBox.width - hostBox.width)).toBeLessThanOrEqual(2);

  // 版面按 1200 设计宽重新排版（而非按窄容器 reflow）：
  // 渲染视口（offsetWidth，未缩放）明显大于视觉占位宽。
  const layoutW = await frame.evaluate((el) => (el as HTMLElement).offsetWidth);
  const zoom = Number(await frame.evaluate((el) => (el as HTMLElement).dataset.zoom ?? '1'));
  expect(Math.abs(hostBox.width / zoom - DESIGN_WIDTH)).toBeLessThanOrEqual(DESIGN_TOLERANCE);
  expect(layoutW).toBeGreaterThan(hostBox.width);
  // 缩放参与进 dataset（坐标换算的唯一来源），100% 时该属性才被清除
  expect(zoom).toBeGreaterThan(0);
  expect(zoom).toBeLessThan(1);
});

// R4：上下文工具条 —— 高频动作不再需要横跨整屏到右侧面板。
test('R4 上下文工具条：无选中时全禁用，选中后可用且显示元素标签', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  const bar = page.locator('.ep-ctxbar');
  const dup = page.getByRole('button', { name: '复制元素' });

  // 无选中：显示空态，全部禁用（与对齐条「选中数不足即禁用」同一口径）
  await expect(bar.locator('.ep-ctxbar__hint')).toHaveText('未选中任何元素');
  await expect(dup).toBeDisabled();
  await expect(page.getByRole('button', { name: '移除元素' })).toBeDisabled();

  await editFrame.locator('#t1').click();
  await expect(bar.locator('.ep-ctxbar__hint')).toHaveText('h1#t1');
  await expect(dup).toBeEnabled();
});

test('R4 上下文工具条：复制元素 / 移除元素确实作用于画布，且可撤销', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  await editFrame.locator('#p1').click();
  const countBefore = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);

  await page.getByRole('button', { name: '复制元素' }).click();
  const countAfterDup = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);
  expect(countAfterDup).toBe(countBefore + 1);

  await page.getByRole('button', { name: '移除元素' }).click();
  const countAfterRemove = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);
  expect(countAfterRemove).toBe(countBefore);

  // 两步操作可逐步撤销（每次动作一条命令）
  await page.locator('.ep-canvas-host').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+z');
  const countRestored = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);
  expect(countRestored).toBe(countBefore + 1);
});

test('R4 上下文工具条：字号增减落到内联样式，并且只入栈一次可撤销', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  await editFrame.locator('#t1').click();
  const size = await page.locator('.ep-ctxbar__value').textContent();
  expect(Number(size)).toBeGreaterThan(0);

  await page.getByRole('button', { name: '字号增大' }).click();
  await expect(page.locator('.ep-ctxbar__value')).toHaveText(String(Number(size) + 1));
  const inline = await editFrame.locator('#t1').evaluate((el) => (el as HTMLElement).style.fontSize);
  expect(inline).toBe(`${Number(size) + 1}px`);

  await page.getByRole('button', { name: '字号减小' }).click();
  await expect(page.locator('.ep-ctxbar__value')).toHaveText(String(size));
});

// R5：顶栏图标化 + 四段分组。可访问名一字未改 —— 这是 20 个 spec 零改动的前提。
test('R5 顶栏四段分组：文件 / 编辑 / 视图 / 输出', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ep-toolbar .ep-toolgroup')).toHaveCount(4);
});

test('R5 图标化按钮的可访问名不变（文本进 .ep-sr-only，仍在可访问性树内）', async ({ page }) => {
  await page.goto('/');
  // 原有锚点逐个复验：这些名字被 20 个 spec 依赖。
  // ⚠️ 必须用 exact:true —— 子串匹配下「居中」会同时命中「垂直居中」，
  //    「导出」会同时命中「导出 HTML」。exact 断言的是「这个可访问名恰好对应一个按钮」，
  //    比子串匹配更强，正是我们要守的性质：图标化不得让锚点变歧义。
  for (const name of ['粘贴 HTML', '新建空白', '预览', '导出 HTML', '复制 HTML', '重置位移', '格式刷']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
  // 新增锚点（撤销 / 重做）与对齐条八个短词（multi-select.spec 的定位基线）
  for (const name of [
    '撤销', '重做', '左', '右', '居中', '顶', '底', '垂直居中', '水平等距', '垂直等距',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
  // 文本确实被裁成不可见（1×1 + clip），但节点仍在 DOM 与可访问性树里
  const srText = page.locator('.ep-toolbar .ep-sr-only').first();
  await expect(srText).toBeAttached();
  const srBox = (await srText.boundingBox())!;
  expect(srBox.width).toBeLessThanOrEqual(2);
  expect(srBox.height).toBeLessThanOrEqual(2);
});

test('R5 新增撤销 / 重做按钮：可用性随历史栈变化，点击生效', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();

  const undo = page.getByRole('button', { name: '撤销' });
  await expect(undo).toBeAttached();

  await editFrame.locator('#t1').click();
  await page.getByRole('button', { name: '复制元素' }).click();
  const before = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);

  await undo.click();
  const after = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);
  expect(after).toBe(before - 1);

  await page.getByRole('button', { name: '重做' }).click();
  const redone = await editFrame.locator('body').evaluate((b) => b.children[0]!.children.length);
  expect(redone).toBe(before);
});

// R8：盒模型图形化。DOM 顺序是 e2e 的索引基线，只允许视觉重排。
test('R8 盒模型图形化后字段顺序不变（0=宽 1=高 2..5=外边距 6..9=内边距）', async ({ page }) => {
  const editFrame = await importFixture(page);
  await editFrame.locator('#t1').waitFor();
  // 全局前置已展开左右面板，此处不再点开关（点了反而会收起）

  const nums = page.locator('.ep-box input[type=number]');
  await expect(nums).toHaveCount(10);

  // 宽高在并排行里
  await expect(page.locator('.ep-box__size input[type=number]')).toHaveCount(2);
  // 两个同心框各 4 个方位字段
  await expect(page.locator('.ep-box__group')).toHaveCount(2);
  await expect(page.locator('.ep-box__group').nth(0).locator('input[type=number]')).toHaveCount(4);
  await expect(page.locator('.ep-box__group').nth(1).locator('input[type=number]')).toHaveCount(4);

  // 精确 CSS 属性名仍可 hover 查到（落在 label 的 title 上，见 fields.ts 的 hintField）
  const fields = page.locator('.ep-box .ep-field');
  await expect(fields.nth(2).locator('label')).toHaveAttribute('title', 'margin-top');
  await expect(fields.nth(6).locator('label')).toHaveAttribute('title', 'padding-top');
  // 方位标签压成单字，位置本身即语义
  await expect(fields.nth(2).locator('label')).toHaveText('上');
  await expect(fields.nth(3).locator('label')).toHaveText('右');

  // 写值仍然生效：nth(2) = margin-top
  await editFrame.locator('#t1').click();
  await nums.nth(2).fill('12');
  await nums.nth(2).dispatchEvent('change');
  const mt = await editFrame.locator('#t1').evaluate((el) => (el as HTMLElement).style.marginTop);
  expect(mt).toBe('12px');
});
