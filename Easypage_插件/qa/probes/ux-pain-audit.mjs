// UX 痛点取证探针 —— 为「借鉴 Canva / Figma 的编辑器重构」建立实证链。
//
// 只做度量与截图，不改任何产品代码。回答四个问题：
//   1. 面板展开时，画布还剩多少宽度？被编辑页面是否横向溢出（看不全）？
//   2. 一次「改字号」要跨多少距离、经过多少个控件？
//   3. 预览态到底长什么样？切进/切出各要几步？能否边编辑边对照？
//   4. 编辑反馈（就地改字 / 选中 / 缩放）在视觉上有多少信息量？
//
// 用法：node qa/probes/ux-pain-audit.mjs [--out test-results/ux]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4201;
const URL = `http://localhost:${PORT}`;
const OUT_DIR = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'test-results/ux';

const LAYOUT_KEY = 'easypage:layout';

const SAMPLE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>春季活动页</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:32px;color:#1f2937}
  h1{font-size:34px;margin:0 0 12px}
  p{font-size:15px;line-height:1.7;color:#5b6472;margin:0 0 16px}
  .promo{background:#eef4ff;border:1px solid #d6e2fb;border-radius:10px;padding:16px;box-sizing:border-box}
</style></head>
<body>
  <h1>春季焕新季</h1>
  <p>全场低至五折，会员额外享 9 折，活动截止 4 月 30 日。</p>
  <div class="promo" style="width:280px;height:150px">限时礼包 · 点此领取</div>
</body>
</html>`;

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(URL, { method: 'GET' });
        if (res.ok || res.status === 200) return resolve();
      } catch { /* 还没起来 */ }
      if (Date.now() > deadline) return reject(new Error(`dev server ${timeoutMs}ms 内未就绪`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

/** 外壳 + 画布几何快照。 */
const SNAP = () => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      x: Math.round(b.x), y: Math.round(b.y),
      display: cs.display, visibility: cs.visibility,
    };
  };
  const frame = document.getElementById('ep-canvas-frame');
  let inner = null;
  try {
    const d = frame && frame.contentDocument;
    if (d) {
      inner = {
        scrollW: d.documentElement.scrollWidth,
        clientW: d.documentElement.clientWidth,
        scrollH: d.documentElement.scrollHeight,
        clientH: d.documentElement.clientHeight,
        bodyText: (d.body?.innerText || '').slice(0, 40),
      };
    }
  } catch { /* 跨域不该发生 */ }
  const stylePanel = document.querySelector('aside.ep-panel');
  const topbarBtns = Array.from(document.querySelectorAll('.ep-topbar button'));
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    doc: {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      scrollH: document.documentElement.scrollHeight,
    },
    canvasFrame: r('#ep-canvas-frame'),
    canvasInner: inner,
    previewFrame: r('#ep-preview-frame'),
    previewHost: r('.ep-preview-host'),
    alignBar: r('.ep-alignbar'),
    breadcrumb: r('#ep-breadcrumb'),
    elementsPanel: r('aside.ep-elements'),
    layersPanel: r('aside.ep-layers'),
    stylePanel: r('aside.ep-panel'),
    topbar: {
      buttonCount: topbarBtns.length,
      labels: topbarBtns.map((b) => b.textContent.trim()),
      withIcon: topbarBtns.filter((b) => b.querySelector('svg,img')).length,
    },
    alignbarButtonCount: document.querySelectorAll('.ep-alignbar button').length,
    styleFieldCount: stylePanel ? stylePanel.querySelectorAll('.ep-field').length : 0,
    styleScroll: stylePanel
      ? { scrollH: stylePanel.scrollHeight, clientH: stylePanel.clientHeight }
      : null,
    layersRowButtons: document.querySelectorAll('.ep-layer-row button').length,
    selectedHandles: document.querySelectorAll('#ep-overlay-root [data-dir]').length,
  };
};

const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  shell: true, stdio: 'ignore', detached: false,
});

const report = {};
let browser;
try {
  await waitForServer(60_000);
  mkdirSync(OUT_DIR, { recursive: true });
  browser = await chromium.launch();

  const mk = (layout) => browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: {
      cookies: [],
      origins: [{ origin: URL, localStorage: [{ name: LAYOUT_KEY, value: JSON.stringify(layout) }] }],
    },
  });

  // ── A. 空态 ──────────────────────────────────────────────
  let ctx = await mk({ left: false, right: false });
  let page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT_DIR}/a-empty.png` });
  report.empty = await page.evaluate(SNAP);

  // 导入
  await page.locator('textarea').fill(SAMPLE);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(400);
  const frame = page.frameLocator('#ep-canvas-frame');
  await frame.locator('.promo').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/b-canvas-first.png` });
  report.canvasFirst = await page.evaluate(SNAP);

  // 距离度量：从选中元素右边缘到样式面板第一个数字输入框的水平跨度
  report.editDistance = await page.evaluate(() => {
    const sel = document.getElementById('ep-selected-box');
    const field = document.querySelector('aside.ep-panel .ep-field input, aside.ep-panel .ep-field select');
    if (!sel || !field) return null;
    const a = sel.getBoundingClientRect();
    const b = field.getBoundingClientRect();
    return { fromX: Math.round(a.right), toX: Math.round(b.left), px: Math.round(b.left - a.right) };
  });
  await ctx.close();

  // ── B. 双面板展开 ────────────────────────────────────────
  ctx = await mk({ left: true, right: true });
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('textarea').fill(SAMPLE);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(400);
  const frame2 = page.frameLocator('#ep-canvas-frame');
  await frame2.locator('.promo').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/c-panels-open.png` });
  report.panelsOpen = await page.evaluate(SNAP);

  // ── B2. 就地改字 ─────────────────────────────────────────
  await frame2.locator('h1').dblclick();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/d-inline-edit.png` });
  report.inlineEdit = await page.evaluate(() => {
    const frame = document.getElementById('ep-canvas-frame');
    const d = frame.contentDocument;
    const el = d.querySelector('[data-ep-editing]');
    const cs = el ? getComputedStyle(el) : null;
    const shellToast = document.querySelector('.ep-toast');
    return {
      editingEl: el ? el.tagName : null,
      outline: cs ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : null,
      shellHintVisible: shellToast
        ? getComputedStyle(shellToast).visibility !== 'hidden'
        : false,
      shellHintText: shellToast ? shellToast.textContent : null,
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ── C. 预览态 ────────────────────────────────────────────
  await page.getByRole('button', { name: '预览' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT_DIR}/e-preview.png` });
  report.preview = await page.evaluate(() => {
    const canvasCol = document.querySelector('.ep-canvas-col');
    const prev = document.querySelector('.ep-preview-host');
    const frame = document.getElementById('ep-preview-frame');
    const b = prev ? prev.getBoundingClientRect() : null;
    let inner = null;
    try {
      const d = frame && frame.contentDocument;
      if (d) inner = { scrollH: d.documentElement.scrollHeight, clientH: d.documentElement.clientHeight };
    } catch { /* ignore */ }
    return {
      canvasColDisplay: canvasCol ? getComputedStyle(canvasCol).display : null,
      canvasColRect: canvasCol ? Math.round(canvasCol.getBoundingClientRect().width) : null,
      previewHostRect: b ? { w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y) } : null,
      previewInner: inner,
      docScrollH: document.documentElement.scrollHeight,
      // 预览态下还能不能点画布元素（能否边对照边改）
      canvasFrameInDom: !!document.getElementById('ep-canvas-frame'),
      canvasFrameVisible: (() => {
        const f = document.getElementById('ep-canvas-frame');
        return f ? f.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : null;
      })(),
      toggleLabel: Array.from(document.querySelectorAll('.ep-topbar button'))
        .map((x) => x.textContent.trim()).join('|'),
    };
  });
  await ctx.close();

  // ── D. 窄视口（1366×768 笔记本，扣掉浏览器 chrome）────────
  const ctxN = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    storageState: {
      cookies: [],
      origins: [{ origin: URL, localStorage: [{ name: LAYOUT_KEY, value: JSON.stringify({ left: true, right: true }) }] }],
    },
  });
  const pageN = await ctxN.newPage();
  await pageN.goto(URL, { waitUntil: 'networkidle' });
  await pageN.locator('textarea').fill(SAMPLE);
  await pageN.getByRole('button', { name: '导入 HTML' }).click();
  await pageN.waitForTimeout(400);
  await pageN.screenshot({ path: `${OUT_DIR}/f-narrow-panels.png` });
  report.narrow = await pageN.evaluate(SNAP);
  await ctxN.close();

  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
