// 可行性探针：把「另存副本」改走**浏览器下载**（用户 2026-09-23 傍晚提案）之前，
// 先坐实三个机器可证的事实。全程不起 OS 对话框 —— 下载事件由 Playwright 捕获。
//
//   Q1 🔴 `file://` 页面里 `URL.createObjectURL` + `<a download>` 到底能不能触发下载？
//       （这是整个提案的地基；若这条不通，提案直接否掉）
//   Q2 🔴 `download` 属性给的**文件名**（含中文 + `_改` 后缀）被尊重吗？
//   Q3 🔴 落盘字节与页面里造的 HTML **逐字节一致**吗？
//   Q4 连续两次下载会不会撞上 Chrome 的「多文件下载确认」？（能自动观察就观察，
//       观察不到就如实标 G1 —— 这条本来就是 OS/浏览器 UI 行为）
//
// 结论打印在末尾；JSON 证据写 test-results/capability/download-write-capability.json。

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const TMP = 'test-results-ep/download-probe';
const PAGE_NAME = 'probe-page.html';
const PAGE_PATH = join(TMP, PAGE_NAME);
const MARKER = 'DOWNLOAD-PROBE-' + Date.now();
const HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>下载探针</title></head><body><h1 id="h">${MARKER}</h1></body></html>`;

/** 探针自检（开浏览器之前）：夹具能还原。 */
if (!HTML.includes(MARKER)) throw new Error('夹具自检失败');

let results = [];
const check = (name, fn) => {
  try {
    const v = fn();
    results.push({ name, ok: v === true, detail: String(v) });
    console.log(`${v === true ? '✅' : '❌'} ${name}${v === true ? '' : ' ⇒ ' + v}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err) });
    console.log(`❌ ${name} ⇒ 抛错：${err}`);
  }
};
const checkAsync = async (name, fn) => {
  try {
    const v = await fn();
    results.push({ name, ok: v === true, detail: String(v) });
    console.log(`${v === true ? '✅' : '❌'} ${name}${v === true ? '' : ' ⇒ ' + v}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err) });
    console.log(`❌ ${name} ⇒ 抛错：${err}`);
  }
};

mkdirSync(TMP, { recursive: true });
writeFileSync(PAGE_PATH, HTML);
const HREF = pathToFileURL(PAGE_PATH).href.toLowerCase();
console.log(`页面：${HREF}\n`);

const browser = await chromium.launch({ headless: false, acceptDownloads: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
await page.goto(HREF);

// ── Q1 + Q2：blob + a[download] 能不能下载；文件名是否被尊重 ──
const SAVE_NAME = 'probe_改.html';
const dl1Promise = page.waitForEvent('download', { timeout: 8000 });
await page.evaluate((name) => {
  const blob = new Blob(['<p>round-trip-check</p>'], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}, SAVE_NAME);
await checkAsync('Q1 file:// 页面里 blob + a[download] 能触发下载', async () => {
  const dl = await dl1Promise;
  globalThis.__dl1 = dl;
  return true;
});
await checkAsync('Q2 download 属性的文件名（中文 + _改）被尊重', async () => {
  const dl = globalThis.__dl1;
  if (!dl) return '没有下载事件';
  const suggested = dl.suggestedFilename();
  globalThis.__suggested = suggested;
  return suggested === SAVE_NAME ? true : `实际 suggestedFilename = ${suggested}`;
});
await checkAsync('Q3 落盘字节与 blob 内容逐字节一致', async () => {
  const dl = globalThis.__dl1;
  if (!dl) return '没有下载事件';
  const p = join(TMP, 'saved-1.html');
  await dl.saveAs(p);
  return readFileSync(p, 'utf8') === '<p>round-trip-check</p>';
});

// ── Q4：连续第二次下载（间隔 <1s）会不会被「多文件下载确认」挡住 ──
await checkAsync('Q4 连续两次下载（间隔 <1s）都到达', async () => {
  const p2 = page.waitForEvent('download', { timeout: 8000 });
  await page.evaluate(() => {
    const blob = new Blob(['<p>second</p>'], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'probe_改2.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  try {
    const dl2 = await p2;
    await dl2.saveAs(join(TMP, 'saved-2.html'));
    return true;
  } catch {
    return '第二次下载 8s 内未到达 —— 可能被「多文件下载确认」挡住（转人手门禁）';
  }
});

await browser.close();

// ── 汇总 ──
const pass = results.filter((r) => r.ok).length;
console.log(`\n共 ${results.length} 项，通过 ${pass}，失败 ${results.length - pass}`);
if (globalThis.__suggested) console.log(`suggestedFilename 实测：${globalThis.__suggested}`);
console.log('未覆盖（如实标注）：真实用户视角的下载气泡/保留-丢弃提示（浏览器 UI，Playwright 看不见）——转人手门禁 G1。');

mkdirSync('test-results/capability', { recursive: true });
writeFileSync(
  'test-results/capability/download-write-capability.json',
  JSON.stringify({ marker: MARKER, results }, null, 2),
);
rmSync(TMP, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);
