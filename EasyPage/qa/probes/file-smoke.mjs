#!/usr/bin/env node
/**
 * qa/probes/file-smoke.mjs · 单文件产物冒烟探针
 *
 * 用途：`vite build` 后用真实浏览器打开 `file://` 下的 dist/index.html，采集
 *   - 页面标题 / #ep-app 挂载情况 / body 文本片段
 *   - console 消息、pageerror、失败请求
 * 失败判定：出现 pageerror、console error、或 #ep-app 未挂载 → 退出码 1。
 *
 * 用法：node qa/probes/file-smoke.mjs [dist 路径或 HTML 文件路径]
 * 退出码：0=通过；1=有错误；2=找不到目标文件。
 *
 * 来源：由根目录临时脚本 probe-file.mjs 规范化（2026-09-22 基线整理）。
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function targetOf(arg) {
  if (!arg) return resolve(repoRoot, 'dist/index.html');
  const p = isAbsolute(arg) ? arg : resolve(repoRoot, arg);
  if (existsSync(p) && p.endsWith('.html')) return p;
  return resolve(p, 'index.html');
}

const target = targetOf(process.argv[2]);
if (!existsSync(target)) {
  console.error(`RESULT ${JSON.stringify({ ok: false, error: 'target not found', target })}`);
  process.exit(2);
}

const shotDir = resolve(repoRoot, 'test-results');
mkdirSync(shotDir, { recursive: true });
const shotPath = resolve(shotDir, 'file-smoke.png');

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`));

let info = null;
let gotoError = null;
try {
  await page.goto(pathToFileURL(target).href, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(1500);
  info = await page.evaluate(() => {
    const app = document.getElementById('ep-app');
    return {
      title: document.title,
      hasApp: !!app,
      appChildren: app ? app.childElementCount : -1,
      bodyText: (document.body.innerText || '').slice(0, 300),
      scripts: [...document.scripts].map((s) => (s.src ? `ext:${s.src}` : `inline:${s.type}`)),
    };
  });
  await page.screenshot({ path: shotPath });
} catch (e) {
  gotoError = e.message;
} finally {
  await browser.close();
}

const hardErrors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
const mounted = info?.appChildren > 0;
const ok = !gotoError && hardErrors.length === 0 && mounted;

console.log(
  'RESULT ' +
    JSON.stringify(
      { ok, target, mounted, appChildren: info?.appChildren, gotoError, hardErrors, logs, screenshot: shotPath },
      null,
      2,
    ),
);
process.exit(ok ? 0 : 1);
