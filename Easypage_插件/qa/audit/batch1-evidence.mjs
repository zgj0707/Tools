// 批次 1（R1–R5 + R7/R8）落地前后对照截图 —— 同一脚本跑两份 dist，产物名由参数决定。
//
// 用法:
//   node qa/audit/batch1-evidence.mjs <htmlPath> <outDir> <prefix>
//   例: node qa/audit/batch1-evidence.mjs qa/report/ui-refactor-p1/after.html  qa/report/ui-refactor-p1 after
//       node qa/audit/batch1-evidence.mjs qa/report/ui-refactor-p1/before.html qa/report/ui-refactor-p1 before
//
// 设计取舍：
//   · 走 file://（与 T123 取证、与「单文件可直接跑」的产品承诺一致）。预置 localStorage 用
//     addInitScript —— 它在**每个 frame** 都会执行，包括 sandbox="allow-scripts" 的预览帧，
//     那里是 opaque origin，访问 localStorage 会抛 SecurityError 并被记成产品报错，故先判据。
//   · 场景列表按「用户可见的结果」组织，不按实现方式。基线版没有覆盖层 / 缩放 / 分组，
//     对应场景会自然拍出旧样子，或标记 SKIP —— 这正是对照要展示的东西。
//   · 每个场景独立 context，避免相互污染；截图取视口（不 fullPage），因为要看的是首屏手感。
//   · 可访问名一律 exact: 定位 —— getByRole 是**子串匹配**，{name:'平板'} 会同时命中「平板宽度」。
//   · 量测步骤必须容忍元素消失：打开预览会隐藏画布，此时 boundingBox() 返回 null。
//     踩过一次：null.width 让场景被误判 SKIP，而截图其实早已落盘。

import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const [htmlPath, outDir, prefix] = process.argv.slice(2);
if (!htmlPath || !outDir || !prefix) {
  throw new Error('用法: node qa/audit/batch1-evidence.mjs <htmlPath> <outDir> <prefix>');
}
mkdirSync(outDir, { recursive: true });

const FIXTURE = readFileSync('qa/fixtures/01-script-carousel.html', 'utf8');

const LAYOUT_OPEN = JSON.stringify({ left: true, right: true });
const LAYOUT_CLOSED = JSON.stringify({ left: false, right: false });
/** 产品默认视图（批次 1 起）：自动适宽 + 属性区只展开「文字」。 */
const VIEW_DEFAULT = JSON.stringify({ autoFit: true, sections: { text: true, box: false, deco: false } });
/** 全展开视图：便于一次看到全部字段。 */
const VIEW_EXPANDED = JSON.stringify({ autoFit: false, sections: { text: true, box: true, deco: true } });

const WIDE = { width: 1280, height: 720 };
const XL = { width: 1440, height: 900 };
const NARROW = { width: 1024, height: 768 };

const browser = await chromium.launch();
const results = [];

/** 新开一个干净上下文：预置偏好 → 打开页面 → 导入固定 fixture */
async function open({ viewport, layout, view }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(
    ([layoutValue, viewValue]) => {
      try {
        if (window.top !== window.self) return; // 预览帧是 opaque origin，跳过
        localStorage.setItem('easypage:layout', layoutValue);
        localStorage.setItem('easypage:view', viewValue);
      } catch {
        /* 无存储权限：忽略 */
      }
    },
    [layout, view],
  );
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(pathToFileURL(resolve(htmlPath)).href);
  await page.locator('textarea').fill(FIXTURE);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(500);
  return { ctx, page, pageErrors };
}

/**
 * 量测画布几何。打开预览时画布被隐藏 → boundingBox() 返回 null，
 * 这里显式降级为「隐藏」而不是抛错（否则会把已成功截图的场景误记成 SKIP）。
 */
async function geometry(page, viewport) {
  const frame = await page.locator('#ep-canvas-frame').boundingBox();
  const host = await page.locator('.ep-canvas-host').boundingBox();
  const docScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  if (!frame || !host) {
    return { canvas: '隐藏', hostY: null, bottomGap: null, docScroll: docScroll > 0 ? `${docScroll}px` : '无' };
  }
  return {
    canvas: `${Math.round(frame.width)}×${Math.round(frame.height)}`,
    hostY: Math.round(host.y),
    bottomGap: Math.round(viewport.height - (host.y + host.height)),
    docScroll: docScroll > 0 ? `${docScroll}px` : '无',
  };
}

/**
 * 跑一个场景：截图 + 量测 + 记录页面报错。
 * 任一步抛错都记 SKIP（基线版没有对应 DOM 属预期），不中断整轮取证。
 */
async function scenario(id, { viewport, layout = LAYOUT_OPEN, view = VIEW_EXPANDED }, body) {
  const name = `${prefix}-${id}`;
  let handles = null;
  try {
    handles = await open({ viewport, layout, view });
    const meta = (await body(handles)) ?? {};
    await handles.page.screenshot({ path: `${outDir}/${name}.png` });
    const g = await geometry(handles.page, viewport);
    const line = {
      id,
      status: 'OK',
      viewport: `${viewport.width}×${viewport.height}`,
      ...g,
      ...(meta.note ? { note: meta.note } : {}),
      pageErrors: handles.pageErrors,
    };
    results.push(line);
    console.log(
      `  OK    ${name}\n        画布 ${line.canvas} · 下沿留白 ${line.bottomGap ?? '—'}px · 外壳溢出 ${line.docScroll}` +
        (line.note ? `\n        ${line.note}` : '') +
        (line.pageErrors.length ? `\n        ⚠️ pageerror: ${line.pageErrors.join(' | ')}` : ''),
    );
  } catch (e) {
    const reason = e.message.split('\n')[0];
    results.push({ id, status: 'SKIP', reason });
    console.log(`  SKIP  ${name}\n        ${reason}`);
  } finally {
    if (handles) await handles.ctx.close().catch(() => {});
  }
}

const selectH2 = async (page) => {
  await page.frameLocator('#ep-canvas-frame').locator('h2').first().click();
  await page.waitForTimeout(250);
};

/** 预览帧相对视口的**可见高度** —— 缺陷① 最直接的量（帧在屏外时恒为 0）。 */
async function previewFrameVisibility(page) {
  return page.evaluate(() => {
    const f = document.getElementById('ep-preview-frame');
    if (!f) return { mounted: false };
    const b = f.getBoundingClientRect();
    const visible = Math.max(0, Math.min(window.innerHeight, b.bottom) - Math.max(0, b.top));
    return {
      mounted: true,
      rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      visibleH: Math.round(visible),
      vh: window.innerHeight,
    };
  });
}

console.log(`══════ 批次 1 对照取证 · ${prefix} · ${htmlPath} ══════\n`);

// ── 场景 A/B：画布是否吃掉可用高度（缺陷②：画布 608×152 + 下方大片留白 418px）
await scenario('A-canvas-1280x720', { viewport: WIDE, layout: LAYOUT_CLOSED, view: VIEW_DEFAULT }, async () => ({
  note: '产品默认态（双面板收起 · 自动适宽开启）',
}));
await scenario('B-panels-open-1440x900', { viewport: XL, view: VIEW_DEFAULT }, async () => ({
  note: '双面板全开：三栏并存时画布仍吃满可用高度',
}));

// ── 场景 C：选中元素是否推动画布（缺陷③：提示文案宽度变化触发工具条换行翻转 → 画布跳 44px）
// `.ep-toolstrip` 是批次 1 新引入的结构（R5），基线版没有 ⇒ 基线只量画布纵向位移。
await scenario('C-select-element', { viewport: WIDE, view: VIEW_DEFAULT }, async ({ page }) => {
  const stripH = async () => {
    const b = await page.locator('.ep-toolstrip').boundingBox().catch(() => null);
    return b ? `${Math.round(b.height)}px` : '（基线版无 .ep-toolstrip）';
  };
  const stripBefore = await stripH();
  const yBefore = (await page.locator('.ep-canvas-host').boundingBox()).y;
  await selectH2(page);
  const stripAfter = await stripH();
  const yAfter = (await page.locator('.ep-canvas-host').boundingBox()).y;
  return {
    note:
      `工具条带 h ${stripBefore} → ${stripAfter}` +
      ` ｜ 画布 y ${Math.round(yBefore)} → ${Math.round(yAfter)}` +
      ` ｜ 位移 ${Math.round(yAfter - yBefore)}px（0 为不跳动）`,
  };
});

// ── 场景 D：预览（缺陷①：帧可见高度恒为 0 → 点开一片空白）
await scenario('D-preview', { viewport: WIDE, view: VIEW_DEFAULT }, async ({ page }) => {
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.waitForTimeout(800);
  const vis = await previewFrameVisibility(page);
  const overlay = await page.evaluate(() => {
    const el = document.getElementById('ep-preview-overlay');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { size: `${Math.round(r.width)}×${Math.round(r.height)}`, open: el.dataset.open };
  });
  return {
    note:
      (overlay ? `覆盖层 ${overlay.size}（data-open=${overlay.open}）· ` : '无 #ep-preview-overlay（基线版走内嵌预览宿主）· ') +
      (vis.mounted
        ? `预览帧 rect=[${vis.rect.join(',')}] · 可见高度 ${vis.visibleH}/${vis.vh}px`
        : '预览帧未挂载'),
  };
});

// ── 以下 E/F/G 为 after-only 增强项：基线版无对应 DOM，SKIP 即预期
await scenario('E-preview-device-tablet', { viewport: WIDE, view: VIEW_DEFAULT }, async ({ page }) => {
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '平板宽度', exact: true }).click();
  await page.waitForTimeout(500);
  const w = await page.evaluate(() =>
    getComputedStyle(document.getElementById('ep-preview-stage')).getPropertyValue('--ep-preview-w').trim(),
  );
  const vis = await previewFrameVisibility(page);
  return {
    note: `设备档位切平板 → --ep-preview-w=${w} · 预览帧 ${vis.rect ? vis.rect[2] + '×' + vis.rect[3] : '未挂载'}（可见 ${vis.visibleH}px）`,
  };
});
// 场景 F 刻意用**窄视口 + 双面板全开**：这一档画布宿主只有 400 出头的宽度，
// 既能看到自动适宽真的在压（zoom < 1），也是高度链最容易被压垮的一档。
await scenario('F-zoom-narrow-1024x768', { viewport: NARROW, view: VIEW_DEFAULT }, async ({ page }) => {
  const st = await page.evaluate(() => {
    const f = document.getElementById('ep-canvas-frame');
    return {
      zoom: f?.dataset.zoom ?? '（基线版无缩放系统）',
      transform: getComputedStyle(f).transform,
      offsetW: f?.offsetWidth ?? null,
    };
  });
  return {
    note:
      `自动适宽 → dataset.zoom=${st.zoom} · transform=${st.transform} · ` +
      `渲染视口宽 offsetWidth=${st.offsetW}px（设计宽 1200px，即一屏看到整幅版面的 ${st.offsetW ? Math.round((st.offsetW / 1200) * 100) : '—'}%）`,
  };
});
await scenario('G-style-sections', { viewport: XL, view: VIEW_EXPANDED }, async ({ page }) => {
  await selectH2(page);
  const groups = await page.locator('.ep-section').count();
  if (groups === 0) throw new Error('无 .ep-section 分组 —— 基线版属性区未分组');
  const openIds = await page.locator('.ep-section[data-open="true"]').evaluateAll((els) =>
    els.map((e) => e.dataset.section),
  );
  return { note: `属性区分组 ${groups} 个 · 展开 ${openIds.join('/')}` };
});

await browser.close();

const manifestPath = `${outDir}/${prefix}-evidence.json`;
writeFileSync(manifestPath, JSON.stringify({ prefix, htmlPath, results }, null, 2));
console.log(`\n清单 → ${manifestPath}`);
const okCount = results.filter((r) => r.status === 'OK').length;
console.log(`OK ${okCount} · SKIP ${results.length - okCount}`);
