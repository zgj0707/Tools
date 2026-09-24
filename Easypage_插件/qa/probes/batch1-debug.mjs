// 批次 1 落地后的三项「实测取证」探针 —— 这三条都是 e2e 断言看不见、
// 但会真实影响手感的问题，且都靠量测才定位到根因：
//
//   ① 画布高度链路：.ep-main / .ep-canvas-row 交叉轴不是 stretch 时，
//      #ep-canvas-frame 的 height:100% 会落到高度未定的父级 → 按规范视为 auto
//      → 回落到 iframe 固有高度 150px。症状是「画布只有一条，下方大片留白」。
//   ② 选中态对布局的影响：工具条带是 flex-wrap 的，上下文工具条的提示文案
//      从「未选中任何元素」变成「h2」会让它塌回一行，画布整体上跳 44px。
//      症状是「点一下元素画布突然跳」，且会让双击的两次 mousedown 落在不同元素上。
//   ③ 预览开关的状态时序：previewOpen 若在帧 load 完才置位，
//      「刚点开就再点一次」会读到 false 而重复走打开分支 → 表现为「点关关不掉」。
//
// 用法：node qa/probes/batch1-debug.mjs   （需先 npm run dev -- --port 4173）

import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const LAYOUT_PRESET = JSON.stringify({ left: true, right: true });
const VIEW_PRESET = JSON.stringify({
  autoFit: false,
  sections: { text: true, box: true, deco: true },
});

const inlineFixture = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>01</title></head>
<body>
  <div class="carousel" id="main-carousel">
    <div class="slide active"><h2>第一张</h2><p>说明文字一</p></div>
    <div class="slide"><h2>第二张</h2><p>说明文字二</p></div>
  </div>
</body></html>`;

const hoverFixture = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>T123 hover</title>
<style>html,body{margin:0;padding:0}section.hero{min-height:70vh}</style></head>
<body>
  <section class="hero"><h1>主标题</h1><p class="desc">描述文字</p></section>
</body></html>`;

const VIEWPORT = { width: 1280, height: 720 };
let failures = 0;

function check(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const browser = await chromium.launch();

async function open(fixture, viewport = VIEWPORT) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(
    ([layoutKey, layoutValue, viewKey, viewValue]) => {
      // ⚠️ addInitScript 会在**每一个** frame 里执行，包括 sandbox="allow-scripts"
      // 的预览帧 —— 那里是 opaque origin，访问 localStorage 会抛 SecurityError
      // 并被 pageerror 捕获，看起来像产品报错。先在 shell 帧里判据再写。
      try {
        if (window.top !== window.self) return;
        localStorage.setItem(layoutKey, layoutValue);
        localStorage.setItem(viewKey, viewValue);
      } catch {
        /* 预览帧 / 无存储权限：忽略 */
      }
    },
    ['easypage:layout', LAYOUT_PRESET, 'easypage:view', VIEW_PRESET],
  );
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.goto(BASE);
  await page.locator('textarea').fill(fixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  return { ctx, page, consoleErrors };
}

console.log('══════════ ① 画布高度链路 ══════════');
for (const vp of [VIEWPORT, { width: 1440, height: 900 }]) {
  const { ctx, page } = await open(inlineFixture, vp);
  const hostBox = await page.locator('.ep-canvas-host').boundingBox();
  const frameBox = await page.locator('#ep-canvas-frame').boundingBox();
  const bottomGap = vp.height - (hostBox.y + hostBox.height);
  const overflow = hostBox.y + hostBox.height > vp.height;
  const docScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  console.log(
    `  视口 ${vp.width}×${vp.height} · 画布 ${Math.round(frameBox.width)}×${Math.round(frameBox.height)} · 视口下沿留白 ${Math.round(bottomGap)}px · 外壳纵向溢出 ${docScroll > 0 ? `有(${docScroll}px)` : '无'}`,
  );
  check(frameBox.height > 400, `[${vp.width}×${vp.height}] 画布吃掉可用高度（不是 iframe 固有 150px）`, `h=${Math.round(frameBox.height)}`);
  check(Math.abs(frameBox.height - hostBox.height) <= 2, `[${vp.width}×${vp.height}] 帧高 = 宿主高（height:100% 生效）`);
  check(!overflow && docScroll === 0, `[${vp.width}×${vp.height}] 画布不与视口/外壳溢出`);
  check(bottomGap >= 0 && bottomGap <= 80, `[${vp.width}×${vp.height}] 底部无大面积留白`, `${Math.round(bottomGap)}px`);
  await ctx.close();
}

console.log('\n══════════ ② 选中态不推动画布 ══════════');
{
  const { ctx, page, consoleErrors } = await open(inlineFixture);
  const editFrame = page.frameLocator('#ep-canvas-frame');
  const h2 = editFrame.locator('h2').first();

  const measure = async () => {
    const strip = await page.locator('.ep-toolstrip').boundingBox();
    const host = await page.locator('.ep-canvas-host').boundingBox();
    return { strip: Math.round(strip.height), y: Math.round(host.y) };
  };
  const before = await measure();
  console.log(`  初始       工具条带 h=${before.strip} 画布 y=${before.y}`);

  await h2.click();
  await page.waitForTimeout(200);
  const afterSelect = await measure();
  console.log(`  选中 h2 后 工具条带 h=${afterSelect.strip} 画布 y=${afterSelect.y}`);
  check(afterSelect.strip === before.strip, '工具条带高度不随选中态变化');
  check(afterSelect.y === before.y, '画布纵向位置不随选中态变化');

  await h2.dblclick();
  await page.waitForTimeout(300);
  const editing = await editFrame
    .locator('h2')
    .first()
    .evaluate((el) => ({ ce: el.getAttribute('contenteditable'), active: el.ownerDocument.activeElement === el }));
  check(editing.ce === 'true' && editing.active, '双击进入就地编辑（双击未被位移打断）');
  check(consoleErrors.length === 0, '无页面级报错', consoleErrors.join(' | '));

  // 悬停真正的内容外空白区 → 不套高亮框
  await page.reload();
  await page.locator('textarea').fill(hoverFixture);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const fr = await page.locator('#ep-canvas-frame').boundingBox();
  await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height - 20);
  await page.waitForTimeout(250);
  const hover = await page.locator('#ep-hover-box').evaluate((el) => getComputedStyle(el).display);
  check(hover === 'none', '悬停内容外空白区不套高亮框', `display=${hover}`);

  await ctx.close();
}

console.log('\n══════════ ③ 预览开关与状态时序 ══════════');
{
  const { ctx, page, consoleErrors } = await open(inlineFixture);
  const overlayOpen = () => page.evaluate(() => document.getElementById('ep-preview-overlay')?.dataset.open ?? null);
  const frames = () => page.locator('#ep-preview-frame').count();
  const previewBtn = () => page.getByRole('button', { name: '预览', exact: true });

  await previewBtn().click();
  check((await overlayOpen()) === 'true' && (await frames()) === 1, '点开：覆盖层打开且帧已挂载');

  await previewBtn().click();
  check((await overlayOpen()) === 'false', '再点一次：覆盖层关闭（状态同步置位，不是等帧 load 完）');

  await previewBtn().click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await overlayOpen()) === 'false' && (await frames()) === 0, 'Esc 关预览并清掉预览帧');

  await previewBtn().click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  check((await overlayOpen()) === 'false', '覆盖层内的「关闭」按钮生效');

  check(consoleErrors.length === 0, '无页面级报错', consoleErrors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}`);
process.exit(failures === 0 ? 0 : 1);
