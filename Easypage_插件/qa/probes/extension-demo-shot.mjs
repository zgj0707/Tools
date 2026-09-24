// 演示取证：在真实本地页面（qa/fixtures/demo-page.html）上拍「工具条已挂上」的实机截图。
//
// 与 extension-p0-1.mjs 的分工：那个是断言验收（17 项硬检查，自带极简 fixture）；
// 这个是**给人看的**取证 —— 用一份像真活的页面（标题/表格/内联 SVG 流程图），
// 证明插件在「有内容、有样式、有 SVG」的页面上同样不打扰原页面。
//
// 用法：
//   node qa/probes/extension-demo-shot.mjs
//   EP_PROBE_BROWSER="C:\path\to\msedge.exe" node qa/probes/extension-demo-shot.mjs

import { chromium } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSER = process.env.EP_PROBE_BROWSER || undefined;
const EXT_DIR = resolve('dist-extension');
const PAGE = resolve('qa/fixtures/demo-page.html');
const PROFILE = resolve('test-results/demo-shot-profile');
const OUT = resolve('qa/report/p0-1');

if (!existsSync(resolve(EXT_DIR, 'manifest.json'))) {
  console.error('缺少 dist-extension/manifest.json，请先 npm run build:extension');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  ...(BROWSER ? { executablePath: BROWSER } : {}),
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1000, height: 620 },
});

const page = await ctx.newPage();
await page.goto(`file:///${PAGE.replace(/\\/g, '/')}`);
await page.waitForSelector('#ep-root', { timeout: 10_000 });

const editBtn = page.getByRole('button', { name: '编辑模式', exact: true });
await page.screenshot({ path: resolve(OUT, '03-演示页-浏览态.png') });
await editBtn.click();
await page.screenshot({ path: resolve(OUT, '04-演示页-编辑态.png') });

const info = await page.evaluate(() => {
  const bar = document.getElementById('ep-root')?.shadowRoot?.getElementById('ep-ext-bar');
  const box = bar?.getBoundingClientRect();
  return {
    工具条尺寸: box ? `${Math.round(box.width)}×${Math.round(box.height)}` : '未找到',
    页面标题未变: document.querySelector('h1')?.textContent?.trim() ?? '',
    SVG节点数: document.querySelectorAll('svg *').length,
    lightDom残留: [...document.querySelectorAll('*')].filter(
      (el) => el.id !== 'ep-root' && !el.closest('#ep-root') && el.className?.toString?.().includes('ep-'),
    ).length,
  };
});

await ctx.close();

console.log(`载体：${BROWSER ?? 'Playwright 自带 Chromium'}`);
console.table(info);
console.log(`截图 → ${OUT}`);
