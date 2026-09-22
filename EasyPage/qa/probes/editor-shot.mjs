// 真实编辑器实机截图探针 —— C 版视觉落地验收用。
//
// 自起 Vite dev server（独立端口 4199，避免与 e2e 的 4173 冲突）→ 导入示例 HTML
// → 选中一个元素（激活选中框 / 手柄 / 图层高亮 / 面包屑 / 样式面板）→ 截图。
//
// 同时收集：console 错误、页面异常、横向溢出、非本地请求。任何一项非零都会打印出来。
//
// 用法：node qa/probes/editor-shot.mjs [--out test-results/editor]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4199;
const URL = `http://localhost:${PORT}`;
const OUT_DIR = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'test-results/editor';

const SAMPLE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>春季活动页</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:32px;color:#1f2937}
  h1{font-size:34px;margin:0 0 12px}
  p{font-size:15px;line-height:1.7;color:#5b6472;margin:0 0 16px}
  .card{display:flex;gap:12px;margin-top:20px}
  .box{flex:1;padding:20px;border:1px solid #e5e7eb;border-radius:10px}
</style></head>
<body>
  <h1>春季焕新季</h1>
  <p>全场低至五折，会员额外享 9 折，活动截止 4 月 30 日。</p>
  <div class="card"><div class="box">新人礼包</div><div class="box">会员日</div></div>
</body>
</html>`;

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(URL, { method: 'GET' });
        if (res.ok || res.status === 200) return resolve();
      } catch {
        /* 还没起来 */
      }
      if (Date.now() > deadline) return reject(new Error(`dev server ${timeoutMs}ms 内未就绪`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  shell: true,
  stdio: 'ignore',
  detached: false,
});

let browser;
try {
  await waitForServer(60_000);
  mkdirSync(OUT_DIR, { recursive: true });

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) {
      externalRequests.push(u);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });

  // 导入示例 → 选中第一个元素，把「选中框 + 8 手柄 + 图层高亮 + 面包屑 + 样式面板」一次点亮
  await page.locator('textarea').fill(SAMPLE);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(400);

  const frame = page.frameLocator('#ep-canvas-frame');
  await frame.locator('h1').click();
  await page.waitForTimeout(400);

  // 触发一次 toast（不改变文档），让底部胶囊可见
  await page.getByRole('button', { name: '重置位移' }).click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: `${OUT_DIR}/editor-1440x900.png` });

  const metrics = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    canvasFrame: (() => {
      const f = document.getElementById('ep-canvas-frame');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    })(),
    handles: document.querySelectorAll('#ep-overlay-root [data-dir]').length,
    visibleHandles: Array.from(document.querySelectorAll('#ep-overlay-root [data-dir]')).filter(
      (h) => getComputedStyle(h).display !== 'none',
    ).length,
    selectedBox: (() => {
      const b = document.getElementById('ep-selected-box');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), border: getComputedStyle(b).borderTopColor };
    })(),
    handleColor: (() => {
      const h = document.querySelector('#ep-overlay-root [data-dir]');
      return h ? getComputedStyle(h).backgroundColor : null;
    })(),
    toast: document.querySelector('.ep-toast')?.textContent ?? null,
    layerSelectedBg: (() => {
      const row = document.querySelector('.ep-layer-row--selected');
      return row ? getComputedStyle(row).backgroundColor : null;
    })(),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--ep-accent').trim(),
    bg: getComputedStyle(document.body).backgroundColor,
  }));

  console.log(JSON.stringify({ metrics, consoleErrors, pageErrors, externalRequests }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
