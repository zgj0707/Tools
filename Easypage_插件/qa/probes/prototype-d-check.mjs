// 原型 D（批次 1）验收探针 —— 用真实 Chromium 走一遍关键交互，并收集错误与几何。
// 用法：node qa/probes/prototype-d-check.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const FILE = resolve('docs/ui-prototypes/prototype-d-refactor-batch1.html');
const URL_ = pathToFileURL(FILE).href;
const OUT = 'test-results/prototype-d';
mkdirSync(OUT, { recursive: true });

const report = { errors: {}, steps: {} };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
const external = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('requestfailed', (r) => external.push('FAILED ' + r.url()));
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});

// 任一环节崩掉也要把已采集到的报告打出来，否则「哪一步崩的」无从判断
function bail(err){
  report.crashed = String(err && err.message ? err.message : err).split('\n')[0];
  report.errors = { consoleErrors, pageErrors, external };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const GEO = () => {  const r = (s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    if (el.hidden) return { hidden: true };
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y),
      display: cs.display };
  };
  const vp = document.getElementById('ep-viewport');
  const st = document.getElementById('ep-stage');
  const wrap = document.getElementById('ep-page-wrap');
  return {
    docScroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    canvasViewport: r('#ep-viewport'),
    stage: r('#ep-stage'),
    pageWrap: r('#ep-page-wrap'),
    zoomLabel: document.getElementById('ep-zoom-val').textContent,
    scale: wrap ? getComputedStyle(wrap).transform : null,
    selBox: r('#ep-selected-box'),
    hoverBox: r('#ep-hover-box'),
    ctxbar: (() => {
      const c = document.getElementById('ep-ctxbar');
      if (!c || c.dataset.open !== 'true') return { open: false };
      const b = c.getBoundingClientRect();
      return { open: true, w: Math.round(b.width), h: Math.round(b.height),
        x: Math.round(b.x), y: Math.round(b.y) };
    })(),
    visibleHandles: Array.from(document.querySelectorAll('#ep-handle-layer [data-dir]'))
      .filter((h) => !h.hidden).length,
    toolbarBtnCount: document.querySelectorAll('#ep-toolbar .ep-btn').length,
    toolbarIconOnly: document.querySelectorAll('#ep-toolbar .ep-btn--icon').length,
    alignBtnCount: document.querySelectorAll('#ep-alignbar [data-align]').length,
    alignDisabled: Array.from(document.querySelectorAll('#ep-alignbar [data-align]')).filter((b) => b.disabled).length,
    // 画布可用高度占用率：检视口底边是否被浪费
    canvasBottom: (() => { const el = document.getElementById('ep-viewport');
      return el ? Math.round(el.getBoundingClientRect().bottom) : null; })(),
    statusbarBottom: (() => { const el = document.querySelector('.ep-statusbar');
      return el ? Math.round(el.getBoundingClientRect().bottom) : null; })(),
    preview: (() => {
      const p = document.getElementById('ep-preview');
      if (!p || p.dataset.open !== 'true') return { open: false };
      const frame = document.querySelector('.ep-preview__frame');
      if (!frame) return { open: true, frameMissing: true };
      const b = frame.getBoundingClientRect();
      return { open: true, intendedW: frame.style.width, scale: frame.dataset.scale,
        renderedW: Math.round(b.width), renderedH: Math.round(b.height),
        frameY: Math.round(b.y),
        inViewport: b.top >= 0 && b.top < window.innerHeight,
        overflowRight: Math.round(b.right) > window.innerWidth };
    })(),
  };
};

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/01-default.png` });
report.steps.default = await page.evaluate(GEO);

// 选中 h1
await page.locator('#ep-page .pg-h1').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-selected.png` });
report.steps.selected = await page.evaluate(GEO);

// 上下文工具条：字体 +
await page.locator('#ep-ctxbar [data-ctx="fontUp"]').click();
await page.waitForTimeout(200);
report.steps.fontUp = { fontSize: await page.evaluate(() => document.querySelector('#ep-page .pg-h1').style.fontSize) };

// 多选：shift 点另一个
await page.locator('#ep-page .pg-p').click({ modifiers: ['Shift'] });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/03-multi.png` });
report.steps.multi = await page.evaluate(GEO);

// 多选下执行顶对齐（h1 与 p 左边界相同，用左右对齐测不出位移，故测纵向）
await page.locator('#ep-ctxbar [data-align="top"]').click();
await page.waitForTimeout(200);
report.steps.alignTop = {
  h1: await page.evaluate(() => document.querySelector('#ep-page .pg-h1').style.transform),
  p: await page.evaluate(() => document.querySelector('#ep-page .pg-p').style.transform),
};

// 缩放：100% → + → fit
await page.locator('#ep-zoom-val').click();
await page.waitForTimeout(200);
report.steps.zoom100 = await page.evaluate(GEO);
await page.locator('#ep-zoom-in').click();
await page.waitForTimeout(200);
report.steps.zoom110 = { zoom: await page.evaluate(() => document.getElementById('ep-zoom-val').textContent) };
await page.locator('#ep-zoom-fit').click();
await page.waitForTimeout(300);
report.steps.zoomFit = { zoom: await page.evaluate(() => document.getElementById('ep-zoom-val').textContent) };

// 收起双面板 → 自动适应宽度
await page.locator('.ep-topbar__toggle[data-panel], #ep-toolbar [data-act="toggleLeft"]').first().click();
await page.waitForTimeout(200);
await page.locator('#ep-toolbar [data-act="toggleRight"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-panels-closed.png` });
report.steps.panelsClosed = await page.evaluate(GEO);

// 预览覆盖层
await page.locator('#ep-preview-btn').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/05-preview-full.png` });
report.steps.previewFull = await page.evaluate(GEO);
await page.locator('#ep-preview-devices [data-device="375"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-preview-375.png` });
report.steps.preview375 = await page.evaluate(GEO);

// Esc 关闭
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
report.steps.afterEsc = {
  previewOpen: await page.evaluate(() => document.getElementById('ep-preview').dataset.open),
  selStill: await page.evaluate(() => document.getElementById('ep-selected-box').hidden === false),
};

// 属性分组折叠（先把右面板开回来 —— 上一步刻意把它收起了）
await page.locator('#ep-toolbar [data-act="toggleRight"]').click();
await page.locator('#ep-toolbar [data-act="toggleLeft"]').click();
await page.waitForTimeout(400);
await page.locator('.ep-section[data-section="box"] .ep-section__head').click();
await page.waitForTimeout(200);
await page.locator('.ep-section[data-section="text"] .ep-section__head').click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/07-sections.png` });
report.steps.sections = {
  textOpen: await page.getAttribute('.ep-section[data-section="text"]', 'data-open'),
  boxOpen: await page.getAttribute('.ep-section[data-section="box"]', 'data-open'),
};

// 图层 tab
await page.locator('.ep-tab[data-tab="layers"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/08-layers.png` });
report.steps.layers = {
  rows: await page.evaluate(() => document.querySelectorAll('.ep-layer-row').length),
};

// 样式字段真实生效（上一步把「文字」分组折叠了，先展开回来）
await page.locator('.ep-tab[data-tab="insert"]').click();
await page.locator('.ep-section[data-section="text"] .ep-section__head').click();
await page.waitForTimeout(200);
await page.locator('#ep-page .pg-cta').click();
await page.waitForTimeout(200);
await page.locator('#f-size').fill('24');
await page.waitForTimeout(300);
report.steps.fieldApplied = {
  ctaFontSize: await page.evaluate(() => document.querySelector('#ep-page .pg-cta').style.fontSize),
};

report.errors = { consoleErrors, pageErrors, external };
await browser.close();
console.log(JSON.stringify(report, null, 2));
