// file:// 协议能力边界探针 —— 为「插件形态是否可行」建立实证链。
//
// 只做度量，不改任何产品代码。回答四个问题：
//   1. file:// 页面是不是 secure context？（决定 File System Access API 能否调用）
//   2. 若不能，读写本地文件还有哪些兜底路径？
//   3. 所有本地 html 文件是否共享同一个 origin？（决定偏好能否用 localStorage 存）
//   4. file:// 与 http://localhost（安全上下文）对照，差在哪。
//
// 用法：node qa/probes/file-protocol-capability.mjs [--out test-results/capability]
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const OUT_DIR = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'test-results/capability';

const DIR = join(tmpdir(), 'ep-capability');
mkdirSync(DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>cap</title></head>
<body><h1>probe</h1>
<div class="diagram"><svg viewBox="0 0 200 60"><rect x="4" y="4" width="80" height="30"/><path d="M84 19 L116 19"/></svg></div>
</body></html>`;

const fileA = join(DIR, 'a.html');
const fileB = join(DIR, 'b.html');
writeFileSync(fileA, PAGE, 'utf8');
writeFileSync(fileB, PAGE.replace('probe', 'probe-b'), 'utf8');

// 在页面里读过一遍：只做只读探测，绝不调用会弹窗的 picker。
const MEASURE = () => {
  const has = (k) => typeof window[k] === 'function';
  const dl = document.createElement('a');
  return {
    href: location.href.slice(0, 60),
    protocol: location.protocol,
    origin: String(location.origin),
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    // File System Access API（读写原文件的正解）
    showSaveFilePicker: has('showSaveFilePicker'),
    showOpenFilePicker: has('showOpenFilePicker'),
    showDirectoryPicker: has('showDirectoryPicker'),
    // 兜底路径
    inputFile: 'File' in window && 'FileReader' in window,
    blobUrl: typeof URL.createObjectURL === 'function',
    anchorDownload: 'download' in dl,
    // 其它
    clipboardWrite: !!(navigator.clipboard && navigator.clipboard.writeText),
    localStorage: (() => {
      try {
        localStorage.setItem('__ep_probe', 'x');
        return true;
      } catch {
        return false;
      }
    })(),
    cookieWritable: (() => {
      try {
        document.cookie = '__ep=a';
        return document.cookie.includes('__ep=a');
      } catch {
        return false;
      }
    })(),
    cspMeta: !!document.querySelector('meta[http-equiv="Content-Security-Policy" i]'),
  };
};

const rows = [];
const browser = await chromium.launch();

// --- A. file:// 两个不同文件 ---
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(fileA).href);
  const a = await page.evaluate(MEASURE);
  await page.evaluate(() => localStorage.setItem('__ep_shared', 'from-a'));
  rows.push({ scene: 'file:// a.html', ...a });

  await page.goto(pathToFileURL(fileB).href);
  const b = await page.evaluate(MEASURE);
  const shared = await page.evaluate(() => localStorage.getItem('__ep_shared'));
  rows.push({ scene: 'file:// b.html', ...b, crossFileLocalStorage: shared });
  await ctx.close();
}

// --- B. 安全上下文对照（http://localhost）---
{
  const { createServer } = await import('node:http');
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => srv.listen(4321, '127.0.0.1', r));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4321/');
  rows.push({ scene: 'http://127.0.0.1 (对照)', ...(await page.evaluate(MEASURE)) });
  await ctx.close();
  await new Promise((r) => srv.close(r));
}

// --- C. 真实调用：区分「API 不存在」与「仅缺用户手势」 ---
// 只观察错误名，不选文件；带 3s 超时防止原生对话框把无头浏览器挂住。
const TRY_CALL = async (page) =>
  page.evaluate(async () => {
    const race = (p) =>
      Promise.race([
        p.then((h) => ({ settled: 'resolved', name: 'resolved', msg: String(!!h) })),
        new Promise((r) => setTimeout(() => r({ settled: 'timeout', name: 'pending', msg: '对话框已弹出或挂起' }), 3000)),
      ]);
    try {
      return await race(window.showSaveFilePicker({ suggestedName: 'probe.html' }));
    } catch (e) {
      return { settled: 'rejected', name: e.name, msg: String(e.message).slice(0, 140) };
    }
  });

{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(fileA).href);

  const noGesture = await TRY_CALL(page);

  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'ep-probe-btn';
    b.textContent = 'go';
    b.addEventListener('click', () => {
      window.__epCall = (async () => {
        try {
          const h = await window.showSaveFilePicker({ suggestedName: 'probe.html' });
          return { settled: 'resolved', name: 'resolved', msg: String(!!h) };
        } catch (e) {
          return { settled: 'rejected', name: e.name, msg: String(e.message).slice(0, 140) };
        }
      })();
    });
    document.body.appendChild(b);
  });
  await page.click('#ep-probe-btn');
  let withGesture = { settled: 'timeout', name: 'pending', msg: '对话框已弹出或挂起' };
  try {
    withGesture = await Promise.race([
      page.evaluate(() => window.__epCall),
      new Promise((r) => setTimeout(() => r({ settled: 'timeout', name: 'pending', msg: '对话框已弹出或挂起（3s 内未决）' }), 4000)),
    ]);
  } catch (e) {
    withGesture = { settled: 'error', name: 'probe-error', msg: String(e).slice(0, 140) };
  }

  rows.push({ scene: 'file:// showSaveFilePicker', callNoGesture: noGesture, callWithGesture: withGesture });
  await ctx.close();
}

await browser.close();

// --- 输出 ---
const KEYS = [
  'isSecureContext',
  'showSaveFilePicker',
  'showOpenFilePicker',
  'showDirectoryPicker',
  'inputFile',
  'blobUrl',
  'anchorDownload',
  'clipboardWrite',
  'localStorage',
  'cookieWritable',
];
const w = 30;
console.log('\n=== 场景 ===');
for (const r of rows) console.log(`  ${r.scene}  origin=${r.origin}  protocol=${r.protocol}`);
console.log('\n=== 能力矩阵 ===');
console.log('capability'.padEnd(w) + rows.map((r) => r.scene.split(' ')[0].padEnd(16)).join(''));
for (const k of KEYS) {
  console.log(k.padEnd(w) + rows.map((r) => String(r[k]).padEnd(16)).join(''));
}
console.log('\n=== 跨文件 localStorage ===');
console.log('  ' + (rows[1]?.crossFileLocalStorage ?? '(未测到)'));

console.log('\n=== 真实调用 showSaveFilePicker（file://）===');
const call = rows.find((r) => r.callNoGesture);
for (const [label, r] of [
  ['无用户手势', call?.callNoGesture],
  ['有用户手势', call?.callWithGesture],
]) {
  if (r) console.log(`  ${label}：settled=${r.settled}  error=${r.name}  ${r.msg}`);
}

writeFileSync(join(OUT_DIR, 'file-protocol-capability.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`\nJSON → ${join(OUT_DIR, 'file-protocol-capability.json')}\n`);
