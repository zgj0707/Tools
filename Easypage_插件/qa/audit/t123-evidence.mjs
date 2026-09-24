// T123：修复前后对照截图（同一脚本跑两次，产物名由参数决定）
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('用法: node t123-evidence.mjs <输出路径>');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve('dist/index.html')).href);
await page.locator('textarea').fill(readFileSync('qa/fixtures/01-script-carousel.html', 'utf8'));
await page.getByRole('button', { name: '导入 HTML' }).click();
await page.waitForTimeout(600);

const fb = await page.locator('#ep-canvas-frame').boundingBox();
const styleBtn = await page.locator('#ep-app button', { hasText: '样式' }).first().boundingBox();

// 真实动作序列：悬停画布空白 → 移到顶栏 → 打开样式面板
await page.mouse.move(fb.x + 1100, fb.y + 500);
await page.waitForTimeout(250);
await page.mouse.click(styleBtn.x + styleBtn.width / 2, styleBtn.y + styleBtn.height / 2);
await page.waitForTimeout(400);

const st = await page.evaluate(() => {
  const h = document.getElementById('ep-hover-box');
  const b = h.getBoundingClientRect();
  return {
    display: getComputedStyle(h).display,
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
    bg: getComputedStyle(h).backgroundColor,
  };
});
console.log(out + ' → hover 框: ' + JSON.stringify(st));

await page.screenshot({ path: out });
await browser.close();
