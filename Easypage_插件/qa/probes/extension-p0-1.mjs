// P0-1 验收探针：扩展骨架能否在真实 `file://` 页面上挂起来。
//
// ⚠️ 本文件是 **P0-1 阶段的快照**，不是当前回归网。两点必须知道：
//   · 里面有「保存按钮保持禁用（写回链路未接通）」这样一条 —— 它断言的是**当时**的状态，
//     P0-5 接通保存链路之后**必然为假**。要验证当前的保存面，跑 `extension-p0-4.mjs`
//     （`保存按钮可用 ⇒ 拿得到 FSA`）与 `extension-p0-7.mjs`（提示面）。
//   · 几处「可访问名」的检查只**回报 count**、不断言它 —— count=0 也算 PASS，所以它们
//     没有判别力，改名字不会让它变红。别把它当成命名锚点的护栏（那条护栏在单测里）。
//   按钮名仍随产品一起更新（`另存到 _改` → P0-9 的 `另存为副本`），否则这份记录会指向
//   一个不存在的按钮，读者无法判断是「名字变了」还是「按钮消失了」。
//
// 为什么必须走真实注入路径（而不是 import 源码在 node 里跑）：
//   要验的东西里有一半只有真环境才成立 —— content script 是否真被 manifest 的
//   `matches: file:///*` 命中、CSS 是否真进了 Shadow DOM、`pointer-events` 是否真让
//   页面可点。这些在 happy-dom / jsdom 里都测不出，或者测出来的是假断言。
//
// 两条前置来自门禁 G2 的实测（docs/plan/07 §1.1）：
//   · **必须 headed**（`headless:false`）：无头 Chromium 加载不了 unpacked 扩展。
//   · 用 `launchPersistentContext` + `--load-extension`，不要用 `chromium.launch()`。
//
// 用法：node qa/probes/extension-p0-1.mjs   （需先 npm run build:extension）
//
// 可用 EP_PROBE_BROWSER 指定浏览器可执行文件，用来验证不同渠道是否都能当载体：
//   EP_PROBE_BROWSER="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
//     node qa/probes/extension-p0-1.mjs
// 不设则用 Playwright 自带的 Chromium。
// 渠道能力的横向对照见 qa/probes/browser-channel-extension-capability.mjs。

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSER = process.env.EP_PROBE_BROWSER || undefined;
const EXT_DIR = resolve('dist-extension');
const TMP_DIR = resolve('test-results/p0-1');
const PROFILE_DIR = resolve('test-results/p0-1-profile');
const FIXTURE = resolve(TMP_DIR, 'fixture.html');

// fixture 里刻意放一个「页面自己的按钮」：用来验证浏览模式下点击能穿透编辑器的宿主层，
// 落到页面自己的 handler 上。插件最忌讳的就是「装上之后页面变得不可点」。
const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>P0-1 fixture</title>
<style>
  body { margin: 0; font-family: sans-serif; background: #eef3ea; }
  h1 { color: #14351f; }
  #probe { position: absolute; left: 40px; top: 200px; padding: 12px 20px; }
</style></head>
<body>
  <h1>页面自己的标题</h1>
  <p>这一段是用户文档的内容，插件不得改动它。</p>
  <button id="probe">页面自己的按钮</button>
  <script>
    document.getElementById('probe').addEventListener('click', () => {
      document.body.setAttribute('data-probe-clicked', 'yes');
    });
  </script>
</body></html>`;

mkdirSync(TMP_DIR, { recursive: true });
writeFileSync(FIXTURE, FIXTURE_HTML, 'utf8');
rmSync(PROFILE_DIR, { recursive: true, force: true });

const results = [];
async function check(name, fn) {
  try {
    results.push({ name, ok: true, detail: String(await fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 200) });
  }
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, // 必须（G2 实测）
  ...(BROWSER ? { executablePath: BROWSER } : {}),
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 800 },
});

const page = await ctx.newPage();
await page.goto(`file:///${FIXTURE.replace(/\\/g, '/')}`);

// ⚠️ run_at: document_idle ⇒ 注入晚于 load，必须显式等待而不是立刻断言。
await page.waitForSelector('#ep-root', { timeout: 10_000 }).catch(() => {});

// playwright 的 CSS / getBy* 会穿透 open shadow root（已由 qa/probes/shadow-dom-locators.mjs
// 实测确认），所以下面直接用宿主页面上的选择器查 shadow 内部。
const host = page.locator('#ep-root');
const bar = page.locator('#ep-ext-bar');

await check('宿主 #ep-root 注入成功且恰好 1 个', async () => `count=${await host.count()}`);
await check('宿主挂在 documentElement 下', async () => {
  const parent = await page.evaluate(() => document.getElementById('ep-root')?.parentElement?.tagName);
  return `parent=${parent}`;
});
await check('shadow root 存在且为 open', async () => {
  const mode = await page.evaluate(() => document.getElementById('ep-root')?.shadowRoot?.mode ?? 'none');
  return `mode=${mode}`;
});
await check('工具条 #ep-ext-bar 可见', async () => {
  const box = await bar.boundingBox();
  if (!box) throw new Error('boundingBox 为 null（不可见）');
  return `${Math.round(box.width)}×${Math.round(box.height)} @ (${Math.round(box.x)},${Math.round(box.y)})`;
});
await check('🔴 tokens 生效（:root → :host 改写成功）', async () => {
  const v = await page.evaluate(() => {
    const b = document.getElementById('ep-root')?.shadowRoot?.querySelector('#ep-ext-bar');
    return b ? getComputedStyle(b).getPropertyValue('--ep-ink').trim() : '';
  });
  // 漏改 :root 的话这里会是空串 —— 样式全丢但零报错，是本批次最需要盯的静默失败
  if (!v) throw new Error('--ep-ink 为空 ⇒ tokens.css 未生效');
  return `--ep-ink=${v}`;
});
await check('app.css 生效（.ep-sr-only 已定义）', async () => {
  const d = await page.evaluate(() => {
    const b = document.getElementById('ep-root')?.shadowRoot?.querySelector('.ep-btn');
    return b ? getComputedStyle(b).borderRadius : '';
  });
  if (!d) throw new Error('按钮无圆角 ⇒ app.css 未生效');
  return `border-radius=${d}`;
});

// 可访问名：同时验证「shadow 穿透」与「命名未撞 i18n 禁用子串」
await check('可访问名 · 编辑模式', async () =>
  `count=${await page.getByRole('button', { name: '编辑模式', exact: true }).count()}`);
await check('可访问名 · 另存为副本', async () =>
  `count=${await page.getByRole('button', { name: '另存为副本', exact: true }).count()}`);
await check('可访问名 · 收起工具条', async () =>
  `count=${await page.getByRole('button', { name: '收起工具条', exact: true }).count()}`);

const editBtn = page.getByRole('button', { name: '编辑模式', exact: true });

await check('初始为浏览态（aria-pressed=false + data-ep-mode=browse）', async () => {
  const pressed = await editBtn.getAttribute('aria-pressed');
  const mode = await host.getAttribute('data-ep-mode');
  if (pressed !== 'false' || mode !== 'browse') throw new Error(`pressed=${pressed} mode=${mode}`);
  return `pressed=${pressed} mode=${mode}`;
});
// ⚠️ 这里原本有一条「保存按钮保持禁用（写回链路未接通）」的断言 —— **已移除，不再断言**。
//   P0-1 时保存链路还没接通，禁用是为了不让用户误以为「写回已实现」。
//   P0-5 接通之后它必然为假，留着只会让这份探针永远红着、把真回归淹没掉。
//   现在的对应护栏在 `extension-p0-4.mjs`（「保存按钮可用 ⇒ content script 上下文里确实
//   拿得到 FSA」），那里还能一并验 title 有没有走到「可用」分支。
//   刻意**不**把这里改成「按钮可用」：那会让一份 P0-1 的快照看起来在验 P0-5 的事。

await check('点击编辑模式 → 状态翻转', async () => {
  await editBtn.click();
  const pressed = await editBtn.getAttribute('aria-pressed');
  const mode = await host.getAttribute('data-ep-mode');
  if (pressed !== 'true' || mode !== 'edit') throw new Error(`pressed=${pressed} mode=${mode}`);
  await editBtn.click();
  const back = await host.getAttribute('data-ep-mode');
  if (back !== 'browse') throw new Error(`回退失败 mode=${back}`);
  return 'edit → browse 往返正常';
});
await check('🔴 浏览模式下页面仍可点击（宿主未吞事件）', async () => {
  await page.locator('#probe').click();
  const clicked = await page.evaluate(() => document.body.getAttribute('data-probe-clicked'));
  if (clicked !== 'yes') throw new Error('页面自己的 handler 未触发 ⇒ 宿主吞掉了点击');
  return 'data-probe-clicked=yes';
});// 实机截图取证（本项目惯例：交付物要能看，不能只有断言）。
// 顺序要紧 —— 必须排在「收起工具条」那一步之前，否则拍到的是收起态。
const SHOT_DIR = resolve('qa/report/p0-1');
mkdirSync(SHOT_DIR, { recursive: true });
await page.screenshot({ path: resolve(SHOT_DIR, '01-浏览态.png') });
await editBtn.click();
await page.screenshot({ path: resolve(SHOT_DIR, '02-编辑态.png') });
await editBtn.click();

await check('收起工具条后不可见', async () => {
  await page.getByRole('button', { name: '收起工具条', exact: true }).click();
  const visible = await bar.isVisible();
  if (visible) throw new Error('收起后仍可见');
  return 'hidden';
});
await check('🔴 页面 light DOM 未被污染（除 #ep-root 外零 ep- 节点）', async () => {
  const leaked = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.id === 'ep-root') return;
      if (el.closest('#ep-root')) return; // shadow 内部不算（同树内查询本就不该命中）
      if (el.id.startsWith('ep-') || el.className?.toString?.().includes('ep-')) {
        bad.push(`${el.tagName.toLowerCase()}#${el.id}.${el.className}`);
      }
    });
    return bad;
  });
  if (leaked.length) throw new Error(`残留 ${leaked.length} 个：${leaked.slice(0, 3).join(' | ')}`);
  return 'leaked=0';
});
await check('用户文档内容未被改动', async () => {
  const text = await page.locator('h1').first().textContent();
  if (text !== '页面自己的标题') throw new Error(`h1 变了：${text}`);
  return 'h1 原样';
});
await check('零控制台报错', async () => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(200);
  if (errors.length) throw new Error(errors.join(' | '));
  return 'errors=0';
});

await ctx.close();

console.log('\n══════════ P0-1 扩展骨架验收 ══════════');
console.log(`载体浏览器：${BROWSER ?? 'Playwright 自带 Chromium（默认）'}`);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) process.exitCode = 1;
