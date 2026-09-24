#!/usr/bin/env node
/**
 * qa/probes/prototype-shot.mjs · UI 原型自检（截图 + 硬约束判定）
 *
 * 对每个传入的 HTML 做三件事：
 *   1) 以 1440×900 视口在真实浏览器打开（file:// 协议）
 *   2) 判定硬约束：无 console 错误、无外链请求、无横向溢出（scrollWidth ≤ clientWidth）
 *   3) 落一张 1440×900 截图到 test-results/prototypes/
 *
 * 用法：node qa/probes/prototype-shot.mjs <file.html> [more.html ...]
 * 退出码：0 = 全部通过；1 = 有文件未通过；2 = 参数错误/文件不存在。
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = resolve(root, 'test-results', 'prototypes');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('用法: node qa/probes/prototype-shot.mjs <file.html> [...]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const results = [];

for (const arg of args) {
  const path = isAbsolute(arg) ? arg : resolve(root, arg);
  if (!existsSync(path)) {
    results.push({ file: arg, ok: false, error: 'file not found' });
    continue;
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const consoleErrors = [];
  const externalRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'))
      externalRequests.push(u);
  });

  await page.goto(pathToFileURL(path).href, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const metrics = await page.evaluate(() => ({
    title: document.title,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }));

  const shot = resolve(outDir, basename(path).replace(/\.html$/, '') + '.1440x900.png');
  await page.screenshot({ path: shot });
  await page.close();

  const overflowX = metrics.scrollW > metrics.clientW;
  results.push({
    file: basename(path),
    ok: consoleErrors.length === 0 && externalRequests.length === 0 && !overflowX,
    title: metrics.title,
    viewport: '1440x900',
    overflowX,
    scrollSize: `${metrics.scrollW}x${metrics.scrollH}`,
    externalRequests,
    consoleErrors,
    screenshot: shot,
  });
}

await browser.close();
console.log('RESULT ' + JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
