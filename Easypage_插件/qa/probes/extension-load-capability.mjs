// MV3 扩展加载能力探针 —— 回答本方案 §8 门禁 G2。
//
// 只做度量，不改任何产品代码。回答三个问题：
//   1. Playwright 无头模式下能否加载 unpacked MV3 扩展？
//   2. content script 能否注入 file:// 页面？（新 profile 下是否默认开启文件访问）
//   3. 若能，注入时机与可见性如何？
//
// 用法：node qa/probes/extension-load-capability.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const EXT = mkdtempSync(join(tmpdir(), 'ep-ext-'));
const PROFILE = mkdtempSync(join(tmpdir(), 'ep-profile-'));

writeFileSync(
  join(EXT, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 3,
      name: 'EP Capability Probe',
      version: '0.0.1',
      content_scripts: [
        {
          matches: ['file:///*', 'http://127.0.0.1/*'],
          js: ['content.js'],
          run_at: 'document_idle',
        },
      ],
    },
    null,
    2,
  ),
  'utf8',
);

writeFileSync(
  join(EXT, 'content.js'),
  `document.documentElement.setAttribute('data-ep-probe', 'injected');
   document.documentElement.setAttribute('data-ep-probe-secure', String(window.isSecureContext));
   document.documentElement.setAttribute('data-ep-probe-fsa', String(typeof window.showSaveFilePicker === 'function'));`,
  'utf8',
);

const PAGE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>t</title></head><body><h1>t</h1></body></html>';
const localFile = join(EXT, '..', 'ep-probe-page.html');
writeFileSync(localFile, PAGE, 'utf8');

const srv = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  r.end(PAGE);
});
await new Promise((r) => srv.listen(4322, '127.0.0.1', r));

const results = [];

for (const headless of [true, false]) {
  const dir = `${PROFILE}-${headless ? 'h' : 'v'}`;
  const row = { headless, launched: false, serviceWorker: null, http: null, file: null, error: null };
  let ctx = null;
  try {
    ctx = await chromium.launchPersistentContext(dir, {
      headless,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    row.launched = true;

    // 扩展是否真的被加载：看有无扩展的 service worker / background 页
    try {
      const t0 = Date.now();
      let workers = ctx.serviceWorkers();
      while (workers.length === 0 && Date.now() - t0 < 3000) {
        await new Promise((r) => setTimeout(r, 200));
        workers = ctx.serviceWorkers();
      }
      row.serviceWorker = workers.length > 0 ? workers.map((w) => w.url()).join(',') : '(无，见 http/file 注入结果)';
    } catch (e) {
      row.serviceWorker = `err: ${String(e).slice(0, 80)}`;
    }

    // http 页注入
    const p1 = await ctx.newPage();
    await p1.goto('http://127.0.0.1:4322/');
    row.http = (await p1.getAttribute('html', 'data-ep-probe')) ?? 'NOT-INJECTED';
    await p1.close();

    // file:// 页注入（检验新 profile 下扩展是否默认可访问文件网址）
    const p2 = await ctx.newPage();
    await p2.goto(pathToFileURL(localFile).href);
    row.file = (await p2.getAttribute('html', 'data-ep-probe')) ?? 'NOT-INJECTED';
    row.fileSecure = await p2.getAttribute('html', 'data-ep-probe-secure');
    row.fileFsa = await p2.getAttribute('html', 'data-ep-probe-fsa');
    await p2.close();
  } catch (e) {
    row.error = String(e).slice(0, 200);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
  results.push(row);
}

await new Promise((r) => srv.close(r));

console.log('\n=== MV3 扩展加载能力（Playwright + Chromium）===');
for (const r of results) {
  console.log(`\n-- headless=${r.headless} --`);
  console.log(`  launched        : ${r.launched}`);
  console.log(`  service worker  : ${r.serviceWorker}`);
  console.log(`  http 注入       : ${r.http}`);
  console.log(`  file:// 注入    : ${r.file}`);
  if (r.fileSecure) console.log(`  file:// secure  : ${r.fileSecure}    FSA: ${r.fileFsa}`);
  if (r.error) console.log(`  error           : ${r.error}`);
}

try {
  rmSync(EXT, { recursive: true, force: true });
  rmSync(localFile, { force: true });
} catch {}
console.log('\n清理完成\n');
