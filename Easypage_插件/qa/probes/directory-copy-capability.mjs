// 「不覆写原文件 · 把 html 与依赖复制进 _改/」的能力探针
//
// 背景：用户要求改为「不覆写原文件；复制一份 css 和 js；新建 _改/ 存放改后的 html 与依赖」。
// 这条诉求能否落地，取决于三件**不能靠推理、只能实测**的事：
//   ① `file://` 下 `showDirectoryPicker` 是否真的可用 —— 要用它建目录并写多个文件；
//      （P0-5 只验过 `showSaveFilePicker`，那是**另一套**语义：单文件、无目录能力。）
//   ② 能不能**读出**同目录 css/js 的内容 —— 复制的前提是先拿到内容；
//   ③ 读内容有没有替代通道（SW + host_permissions、`--allow-file-access-from-files`）。
//
// 只做度量，不改产品代码。产出 `test-results/capability/directory-copy-capability.json`。
//
// ── 四个测试组，以及为什么这么分组 ──
//   G1  无扩展 · 默认启动参数              —— 基线
//   G2  无扩展 · 加 --allow-file-access-from-files —— 确认「读同目录」是不是只差这一个 flag
//   G3  临时探针扩展（**无** file host_permissions）—— content script 隔离世界 + SW 的默认能力
//   G4  临时探针扩展（**有** file host_permissions）—— host_permissions 能否让 SW 读到盘上文件
//   G3/G4 一次启动（两个扩展同时加载）：G2 已实测「无头加载不了 unpacked 扩展」，
//   而有头启动较慢，能省一次就省一次。
//
// ⚠️ 有头组会真的弹出系统级目录选择框。脚本用 2s 超时抢占并立即关浏览器，
//    但框**可能残留** —— 看到残留请按 Esc 关掉，那是探针的产物，不是插件弹的。
//
// 用法：node qa/probes/directory-copy-capability.mjs
//      （需要在仓库根目录跑；脚本自己不读 git，不写产品代码）

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT_DIR = join(REPO, 'test-results', 'capability');
const WORK = join(REPO, 'test-results', 'probe-copy');
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(WORK, { recursive: true });

// ── 夹具：一份**真的**多文件页面 ──────────────────────────────────────
// `probe-marker` 出现在 css/js 里，用于确认「读到的确实是这一份」，而不是空串或别的东西。
const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>copy probe</title>
<link rel="stylesheet" href="styles.css">
</head><body>
<h1 id="h">依赖探针</h1>
<p id="tick">脚本还没跑起来。</p>
<script src="app.js"></script>
</body></html>`;
const CSS = `/* probe-marker-css */\n#h { color: rgb(22, 93, 255); }\n`;
const JS = `/* probe-marker-js */\ndocument.getElementById('tick').textContent = '脚本已跑起来';`;

writeFileSync(join(WORK, 'index.html'), PAGE, 'utf8');
writeFileSync(join(WORK, 'styles.css'), CSS, 'utf8');
writeFileSync(join(WORK, 'app.js'), JS, 'utf8');
const PAGE_URL = pathToFileURL(join(WORK, 'index.html')).href;

// ── 临时探针扩展的两份源码 ───────────────────────────────────────────
const CONTENT_JS = (key) => `
(async () => {
  const KEY = ${JSON.stringify(key)};
  const out = { key: KEY, world: 'content-script', href: location.href };
  out.fns = {
    showDirectoryPicker: typeof window.showDirectoryPicker === 'function',
    showSaveFilePicker: typeof window.showSaveFilePicker === 'function',
  };
  const tryFetch = async (u) => {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      const t = await r.text();
      return { ok: true, status: r.status, len: t.length, hit: t.includes('probe-marker') };
    } catch (e) { return { ok: false, err: e.name, msg: String(e.message).slice(0, 150) }; }
  };
  out.fetchCss = await tryFetch('styles.css');
  out.fetchJs = await tryFetch('app.js');

  const link = document.querySelector('link[rel~="stylesheet"]');
  try {
    out.cssRules = link && link.sheet
      ? { rules: link.sheet.cssRules.length,
          hit: Array.from(link.sheet.cssRules).map((r) => r.cssText).join('').includes('#h') }
      : { sheet: null };
  } catch (e) { out.cssRules = { err: e.name, msg: String(e.message).slice(0, 150) }; }

  // 外部脚本的 inline text 是空串 —— 顺带确认「这条路本来就不通」，免得日后有人再试。
  out.scriptText = Array.from(document.scripts).map((s) => (s.src ? (s.text || '').length : -1));

  // 请 SW 帮忙读：SW 用**扩展的** origin + host_permissions，与页面的同源策略无关。
  const askSw = (u) => new Promise((res) => {
    try {
      chrome.runtime.sendMessage({ type: 'read', url: u }, (r) => res(r ?? { ok: false, err: 'no-response' }));
    } catch (e) { res({ ok: false, err: String(e).slice(0, 150) }); }
  });
  out.swRelCss = await askSw('styles.css');                                  // 相对路径：SW 里会按扩展 origin 解析
  out.swAbsCss = await askSw(new URL('styles.css', location.href).href);     // 绝对 file:// URL
  out.swAbsJs = await askSw(new URL('app.js', location.href).href);

  document.documentElement.setAttribute('data-ep-probe-' + KEY, JSON.stringify(out));
})();
`;

const SW_JS = `
const read = async (url) => {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const t = await r.text();
    return { ok: true, status: r.status, len: t.length, hit: t.includes('probe-marker') };
  } catch (e) { return { ok: false, err: e.name, msg: String(e.message).slice(0, 200) }; }
};
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'read') return false;
  read(msg.url).then(sendResponse);
  return true; // 异步回 —— 不返回 true 的话消息通道会立刻关掉
});
`;

function writeProbeExtension(dir, { hostPermission, key }) {
  mkdirSync(dir, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: `EP capability probe (${key})`,
    version: '0.0.0',
    content_scripts: [
      { matches: ['file:///*'], js: ['content.js'], run_at: 'document_idle', all_frames: false },
    ],
    background: { service_worker: 'sw.js' },
    permissions: [],
  };
  if (hostPermission) manifest.host_permissions = ['file:///*'];
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(dir, 'content.js'), CONTENT_JS(key), 'utf8');
  writeFileSync(join(dir, 'sw.js'), SW_JS, 'utf8');
  return dir;
}

// ── 页面里做的探测（两个组共用）────────────────────────────────────────
const MEASURE_PAGE = () => {
  const has = (k) => typeof window[k] === 'function';
  return {
    isSecureContext: window.isSecureContext,
    origin: String(location.origin),
    showDirectoryPicker: has('showDirectoryPicker'),
    showSaveFilePicker: has('showSaveFilePicker'),
    showOpenFilePicker: has('showOpenFilePicker'),
  };
};

const MEASURE_READS = async () => {
  const out = {};
  const tryFetch = async (u) => {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      const t = await r.text();
      return { ok: true, status: r.status, len: t.length, hit: t.includes('probe-marker') };
    } catch (e) {
      return { ok: false, err: e.name, msg: String(e.message).slice(0, 150) };
    }
  };
  out.fetchCss = await tryFetch('styles.css');
  out.fetchJs = await tryFetch('app.js');

  out.xhrCss = await new Promise((res) => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', 'styles.css', true);
      x.onload = () =>
        res({
          ok: true,
          status: x.status,
          len: String(x.responseText || '').length,
          hit: String(x.responseText || '').includes('probe-marker'),
        });
      x.onerror = () => res({ ok: false, err: 'onerror', msg: `status=${x.status}` });
      x.send();
    } catch (e) {
      res({ ok: false, err: e.name, msg: String(e.message).slice(0, 150) });
    }
  });

  const link = document.querySelector('link[rel~="stylesheet"]');
  try {
    out.cssRules =
      link && link.sheet
        ? {
            rules: link.sheet.cssRules.length,
            hit: Array.from(link.sheet.cssRules)
              .map((r) => r.cssText)
              .join('')
              .includes('#h'),
          }
        : { sheet: null };
  } catch (e) {
    out.cssRules = { err: e.name, msg: String(e.message).slice(0, 150) };
  }

  out.scriptText = Array.from(document.scripts).map((s) => (s.src ? (s.text || '').length : -1));
  return out;
};

/**
 * 真实调用一个 picker，区分四种结局。
 * 这是本探针最要紧的一格：`AbortError` 与 `SecurityError` 的含义**完全不同** ——
 * 前者 = 已过安全检查、走到「弹原生框」那一步（无头环境没框可弹，于是立即中止）；
 * 后者 = 协议/权限层面根本没让走。把两者混成一个「失败了」就等于没测。
 */
// ⚠️ 这两个函数**必须自包含**：Playwright 会把函数体序列化后丢进页面执行，
// 闭包里的变量一个都拿不到（所以不能在外面拼字符串再用 new Function 传进来 ——
// 那样 `new Function` 会在 **Node 侧**求值，直接碰上不存在的 `window`）。
function callPickerInPage(kind) {
  const fn = window[kind];
  if (typeof fn !== 'function') {
    return Promise.resolve({ settled: 'missing', err: 'not-a-function', msg: 'API 不存在' });
  }
  return Promise.resolve()
    .then(() => fn.call(window))
    .then((h) => ({ settled: 'resolved', err: 'resolved', msg: String(!!h) }))
    .catch((e) => ({ settled: 'rejected', err: e.name, msg: String(e.message).slice(0, 190) }));
}

function armPickerButton(kind) {
  const b = document.createElement('button');
  b.id = '__ep_probe_btn';
  b.textContent = 'go';
  b.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647';
  b.addEventListener('click', () => {
    const fn = window[kind];
    window.__epCall =
      typeof fn !== 'function'
        ? Promise.resolve({ settled: 'missing', err: 'not-a-function', msg: 'API 不存在' })
        : Promise.resolve()
            .then(() => fn.call(window))
            .then((h) => ({ settled: 'resolved', err: 'resolved', msg: String(!!h) }))
            .catch((e) => ({ settled: 'rejected', err: e.name, msg: String(e.message).slice(0, 190) }));
  });
  document.body.appendChild(b);
}

async function measurePicker(page, kind, { gesture, timeout }) {
  const failed = (e) => ({ settled: 'error', err: 'evaluate-failed', msg: String(e).slice(0, 190) });

  // 🔴 顺序要紧：**无手势必须在有手势之前测**。反过来测的话，前面那次点击留下的
  // transient activation 会让「无手势」也走到弹框，这一格就失去区分力了。
  if (!gesture) return page.evaluate(callPickerInPage, kind).catch(failed);

  await page.evaluate(armPickerButton, kind);
  await page.click('#__ep_probe_btn');

  return Promise.race([
    page.evaluate(() => window.__epCall).catch(failed),
    new Promise((res) =>
      setTimeout(
        () => res({ settled: 'timeout', err: 'pending', msg: `${timeout}ms 内未决 —— 对话框已在等人` }),
        timeout,
      ),
    ),
  ]);
}

const results = [];
async function check(name, fn) {
  try {
    results.push({ name, ok: true, detail: String(await fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 200) });
  }
}

const g = {};

// ═══ G1 / G2：无扩展，默认参数 vs --allow-file-access-from-files ═══════
async function runNoExtension(label, extraArgs) {
  const browser = await chromium.launch({ args: extraArgs });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));

  const out = { label, args: extraArgs };
  await page.goto(PAGE_URL);
  await page.waitForTimeout(150);

  // 🔴 前提检查：先确认「同目录资源真的被加载了」，再谈「能不能读」。
  // 若子资源加载本身就失败，那后面所有结论都建在错误前提上。
  out.premise = await page.evaluate(() => ({
    scriptRan: document.getElementById('tick').textContent.includes('脚本已跑起来'),
    cssApplied: getComputedStyle(document.getElementById('h')).color === 'rgb(22, 93, 255)',
  }));

  out.measure = await page.evaluate(MEASURE_PAGE);
  out.reads = await page.evaluate(MEASURE_READS);
  out.dirNoGesture = await measurePicker(page, 'showDirectoryPicker', { gesture: false, timeout: 2500 });
  out.dirWithGesture = await measurePicker(page, 'showDirectoryPicker', { gesture: true, timeout: 3000 });
  out.errors = errors;

  await ctx.close();
  await browser.close();
  return out;
}

await check('G1 夹具前提：同目录 app.js 真的执行 + styles.css 真的生效', async () => {
  g.g1 = await runNoExtension('no-ext-default', []);
  const p = g.g1.premise;
  if (!p.scriptRan && !p.cssApplied) throw new Error('前提双双不成立 —— 结论不可用');
  return `scriptRan=${p.scriptRan}  cssApplied=${p.cssApplied}`;
});

await check('G2 对照：加 --allow-file-access-from-files 后的能力变化', async () => {
  g.g2 = await runNoExtension('no-ext-allow-file-access', ['--allow-file-access-from-files']);
  return `fetchCss.ok=${g.g2.reads.fetchCss.ok}  cssRules=${JSON.stringify(g.g2.reads.cssRules).slice(0, 60)}`;
});

// ═══ G3 / G4：临时探针扩展（隔离世界 + SW）══════════════════════════════
await check('G3/G4 隔离世界 + SW 的能力（需有头；会闪一个目录选择框）', async () => {
  const EXT_PLAIN = writeProbeExtension(join(WORK, 'ext-plain'), { hostPermission: false, key: 'plain' });
  const EXT_HOST = writeProbeExtension(join(WORK, 'ext-host'), { hostPermission: true, key: 'host' });
  const PROFILE = join(WORK, 'profile');

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PLAIN},${EXT_HOST}`,
      `--load-extension=${EXT_PLAIN},${EXT_HOST}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1100, height: 700 },
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  await page.goto(PAGE_URL);

  const readProbe = (key) =>
    page.evaluate((k) => {
      const raw = document.documentElement.getAttribute(`data-ep-probe-${k}`);
      return raw ? JSON.parse(raw) : null;
    }, key);

  // 等两个 content script 各自把结果写进 DOM（SW 往返有延迟）。
  const waitOne = async (key) => {
    for (let i = 0; i < 40; i++) {
      const v = await readProbe(key);
      if (v) return v;
      await page.waitForTimeout(200);
    }
    return null;
  };

  g.g3 = await waitOne('plain');
  g.g4 = await waitOne('host');

  // 有头下再问一次目录选择器：这次要的是「框会不会真的弹出来」（= timeout/pending）。
  const page2 = await ctx.newPage();
  await page2.goto(PAGE_URL);
  g.headedDirPicker = await measurePicker(page2, 'showDirectoryPicker', { gesture: true, timeout: 2500 });

  g.extErrors = errors;
  await ctx.close();

  if (!g.g3 && !g.g4) throw new Error('两个探针扩展都没把结果写回来 —— 隔离世界本身没跑通');
  return `plain=${g.g3 ? 'ok' : 'null'}  host=${g.g4 ? 'ok' : 'null'}`;
});

// ═══ 汇总输出 ═════════════════════════════════════════════════════════
const json = { pageUrl: PAGE_URL, results, groups: g };
writeFileSync(join(OUT_DIR, 'directory-copy-capability.json'), JSON.stringify(json, null, 2), 'utf8');

const line = (s) => console.log(s);
line('\n══════════ 「建目录 + 复制依赖」能力探针 ══════════');
line(`夹具：${PAGE_URL}`);

const showReads = (title, r) => {
  if (!r) return line(`  ${title}: （未测到）`);
  const fmt = (x) =>
    x.ok === true
      ? `OK status=${x.status} len=${x.len} hit=${x.hit}`
      : `❌ ${x.err}${x.msg ? ' — ' + x.msg : ''}`;
  line(`  ${title}:`);
  for (const k of ['fetchCss', 'fetchJs', 'xhrCss']) if (r[k]) line(`    ${k}: ${fmt(r[k])}`);
  if (r.cssRules) line(`    cssRules: ${r.cssRules.err ? '❌ ' + r.cssRules.err + ' — ' + r.cssRules.msg : JSON.stringify(r.cssRules)}`);
  if (r.scriptText) line(`    script.text 长度: ${JSON.stringify(r.scriptText)}（外部脚本恒为 0）`);
};

const showPicker = (title, r) => {
  if (!r) return line(`  ${title}: （未测到）`);
  line(`  ${title}: settled=${r.settled}  err=${r.err}  ${r.msg}`);
};

line('\n── G1 无扩展 · 默认参数 ──');
line(`  前提: scriptRan=${g.g1?.premise?.scriptRan}  cssApplied=${g.g1?.premise?.cssApplied}`);
line(`  API: ${JSON.stringify(g.g1?.measure)}`);
showReads('读取同目录', g.g1?.reads);
showPicker('showDirectoryPicker（无手势）', g.g1?.dirNoGesture);
showPicker('showDirectoryPicker（有手势）', g.g1?.dirWithGesture);

line('\n── G2 无扩展 · --allow-file-access-from-files ──');
showReads('读取同目录', g.g2?.reads);
showPicker('showDirectoryPicker（有手势）', g.g2?.dirWithGesture);

line('\n── G3 隔离世界 · 无 file host_permissions ──');
if (g.g3) {
  line(`  API: ${JSON.stringify(g.g3.fns)}`);
  showReads('content script 内', g.g3);
  line(`  SW 读（相对路径）: ${JSON.stringify(g.g3.swRelCss)}`);
  line(`  SW 读（绝对 file:// URL）: ${JSON.stringify(g.g3.swAbsCss)}`);
} else line('  （未测到）');

line('\n── G4 隔离世界 · 有 file host_permissions ──');
if (g.g4) {
  showReads('content script 内', g.g4);
  line(`  SW 读（绝对 file:// URL · css）: ${JSON.stringify(g.g4.swAbsCss)}`);
  line(`  SW 读（绝对 file:// URL · js）: ${JSON.stringify(g.g4.swAbsJs)}`);
} else line('  （未测到）');

showPicker('有头组 showDirectoryPicker（有手势）', g.headedDirPicker);

line('\n── 断言明细 ──');
for (const r of results) line(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
line(`\nJSON → ${join(OUT_DIR, 'directory-copy-capability.json')}\n`);
