#!/usr/bin/env node
// 易页 EasyPage · 用本机浏览器打开本地 html 并挂上编辑器。
//
// 为什么需要它：unpacked 扩展只能在启动时用 --load-extension 指定，Chrome/Edge 都不会把
// 这一步记进配置。所以「装一次」的正确形态是这个启动器，而不是每次去扩展管理页手点
// 「加载已解压的扩展程序」。
//
// 🔴 为什么要挑浏览器（2026-09-22 实测，见 qa/probes/browser-channel-extension-capability.mjs）
//   Chrome 137 起，**品牌版 Google Chrome 不再接受 --load-extension**，该能力只保留在
//   Chromium / Chrome for Testing 及部分衍生渠道。实测（同一 harness，唯一变量是可执行文件）：
//     Playwright Chromium 1243   ✅ 注入
//     系统 Google Chrome 153     ❌ 未注入（静默忽略、零报错）
//     系统 Microsoft Edge        ✅ 注入
//   静默失败最危险 —— 用户会以为装好了。所以这里主动探测、按主版本号判断，
//   并用 --verify 提供「装完当场自证」的能力。
//
// 用法：
//   node scripts/open-with-easypage.mjs <page.html>      打开并挂上编辑器
//   node scripts/open-with-easypage.mjs <page.html> --verify   打开后连上去确认已注入
//   node scripts/open-with-easypage.mjs --dry-run        只打印解析结果，不启动
//   node scripts/open-with-easypage.mjs --browser <exe>  强制指定浏览器
//   EASYPAGE_BROWSER=<exe> 亦可强制指定

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const LOCAL = process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local');
const REPO = resolve(import.meta.dirname, '..');

/** Chrome 从哪个主版本起在品牌版上忽略 --load-extension（实测 153 已忽略，<137 可用）。 */
const CHROME_LOAD_EXTENSION_LAST_MAJOR = 136;

const EXT_DIR = join(REPO, 'dist-extension');
const PROFILE_DIR = join(LOCAL, 'EasyPage', 'browser-profile');
const PW_ROOT = join(LOCAL, 'ms-playwright');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'dry-run': { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    browser: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('用法: node scripts/open-with-easypage.mjs <page.html> [--verify] [--dry-run] [--browser <exe>]');
  process.exit(0);
}

if (!existsSync(join(EXT_DIR, 'manifest.json'))) {
  console.error(`[x] 未找到扩展产物: ${EXT_DIR}\n    请先在仓库根执行:  npm run build:extension`);
  process.exit(1);
}

/** 从 exe 同级的版本目录名读出主版本（Chrome 系把版本目录放在 Application/ 下）。读不到返回 NaN。 */
function majorOf(exe) {
  try {
    const dir = exe.replace(/[\\/][^\\/]+$/, '');
    const majors = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+\./.test(d.name))
      .map((d) => Number(d.name.split('.')[0]))
      .filter((n) => Number.isFinite(n));
    return majors.length ? Math.max(...majors) : NaN;
  } catch {
    return NaN;
  }
}

/** 找系统 Chrome，并按主版本号判断能否加载 unpacked 扩展。 */
function detectChrome() {
  const roots = [
    'C:\\Program Files\\Google\\Chrome\\Application',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application',
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const exe = join(root, 'chrome.exe');
    if (!existsSync(exe)) continue;
    const major = majorOf(exe);
    if (Number.isFinite(major) && major <= CHROME_LOAD_EXTENSION_LAST_MAJOR) {
      return { exe, why: `系统 Chrome ${major}（主版本 ≤ ${CHROME_LOAD_EXTENSION_LAST_MAJOR}，仍接受 --load-extension）` };
    }
    return {
      exe: null,
      why: `系统 Chrome ${Number.isFinite(major) ? major : '?'} 已忽略 --load-extension（Chrome ${CHROME_LOAD_EXTENSION_LAST_MAJOR + 1}+ 起不再支持），跳过`,
    };
  }
  return { exe: null, why: '未找到系统 Chrome' };
}

function detectEdge() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const exe of cands) {
    if (existsSync(exe)) return { exe, why: '系统 Edge（Chromium 内核，已实测可注入）' };
  }
  return { exe: null, why: '未找到系统 Edge' };
}

function detectPlaywrightChromium() {
  if (!existsSync(PW_ROOT)) return { exe: null, why: '未找到 ms-playwright 目录' };
  const dirs = readdirSync(PW_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^chromium-\d+$/.test(d.name))
    .map((d) => ({ name: d.name, n: Number(d.name.split('-')[1]) }))
    .sort((a, b) => b.n - a.n);
  for (const d of dirs) {
    const exe = join(PW_ROOT, d.name, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return { exe, why: `Playwright 自带 ${d.name}（最可靠，无需额外安装）` };
  }
  return { exe: null, why: 'ms-playwright 下没有可用的 chromium' };
}

// ── 挑选载体：显式指定 > 可用 Chrome > Edge > Playwright Chromium ──
const notes = [];
let picked = null;

const forced = values.browser ?? process.env.EASYPAGE_BROWSER;
if (forced) {
  const exe = resolve(forced);
  if (!existsSync(exe)) {
    console.error(`[x] 指定的浏览器不存在: ${exe}`);
    process.exit(1);
  }
  picked = { exe, why: '由 --browser / EASYPAGE_BROWSER 指定' };
  // 🔴 显式指定也要拦一道：否则用户手动指向 Chrome 137+ 会拿到「浏览器开了但没插件」的静默失败。
  if (/[\\/]chrome\.exe$/i.test(exe) && !/edge/i.test(exe)) {
    const m = majorOf(exe);
    if (Number.isFinite(m) && m > CHROME_LOAD_EXTENSION_LAST_MAJOR) {
      console.warn(
        `[!] 警告：该 Chrome 主版本 ${m} > ${CHROME_LOAD_EXTENSION_LAST_MAJOR}，实测会静默忽略 --load-extension。`,
      );
      console.warn('    现象是「浏览器正常打开、页面正常显示，但页面上没有工具条」，且零报错。');
      console.warn('    建议：去掉 --browser 让脚本自动挑（Edge / Playwright Chromium 均已实测可注入）。');
    }
  }
} else {
  const chrome = detectChrome();
  notes.push(chrome.why);
  if (chrome.exe) picked = chrome;
  if (!picked) {
    const edge = detectEdge();
    notes.push(edge.why);
    if (edge.exe) picked = edge;
  }
  if (!picked) {
    const pw = detectPlaywrightChromium();
    notes.push(pw.why);
    if (pw.exe) picked = pw;
  }
}

if (!picked) {
  console.error('[x] 没有找到任何一个能加载 unpacked 扩展的浏览器。');
  for (const n of notes) console.error(`    · ${n}`);
  console.error('    可用 --browser <可执行文件路径> 显式指定（需 Chromium 内核且不屏蔽该开关）。');
  process.exit(1);
}

const target = positionals[0] ? resolve(positionals[0]) : null;
if (target && !existsSync(target)) {
  console.error(`[x] 文件不存在: ${target}`);
  process.exit(1);
}

const args = [
  `--user-data-dir=${PROFILE_DIR}`,
  `--load-extension=${EXT_DIR}`,
  `--disable-extensions-except=${EXT_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
];

// --verify 需要一个可连的调试端口；连上后当场确认宿主节点在不在，
// 把「静默不加载」这类失败变成一句明确的结论。
const VERIFY_PORT = 9333;
if (values.verify) args.push(`--remote-debugging-port=${VERIFY_PORT}`);
if (target) args.push(`file:///${target.replace(/\\/g, '/')}`);

if (values['dry-run']) {
  console.log('[dry-run] 浏览器: ' + picked.exe);
  console.log('[dry-run] 依据:   ' + picked.why);
  if (notes.length) for (const n of notes) console.log('[dry-run] 探测:   ' + n);
  console.log('[dry-run] 扩展:   ' + EXT_DIR);
  console.log('[dry-run] 配置:   ' + PROFILE_DIR);
  if (target) console.log('[dry-run] 目标:   ' + target);
  console.log('[dry-run] 命令行: ' + [picked.exe, ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '));
  process.exit(0);
}

mkdirSync(PROFILE_DIR, { recursive: true });

// detached + unref：启动器退出后窗口必须留着。这也是本脚本不能用批处理
// `start` 代替的原因之一 —— 那条路径在受管环境里常被拦。
const child = spawn(picked.exe, args, { detached: true, stdio: 'ignore' });
child.unref();

console.log(`[i] 浏览器: ${picked.exe}`);
console.log(`[i] 依据:   ${picked.why}`);
if (target) {
  console.log(`[i] 打开:   ${target}`);
} else {
  console.log('[i] 没指定文件 —— 浏览器已就绪，把要编辑的 html 直接拖进窗口即可。');
  console.log('    （插件对所有 file:// 页面生效，拖进去就能看到右上角工具条）');
}

if (!values.verify) process.exit(0);

// ── --verify：连上去确认扩展真的注入了 ──
const { chromium } = await import('playwright');
const deadline = Date.now() + 20_000;
let ok = false;
let detail = '';

while (Date.now() < deadline && !ok) {
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${VERIFY_PORT}`);
    const pages = browser.contexts().flatMap((c) => c.pages());
    const page = pages.find((p) => p.url().startsWith('file://')) ?? pages[0];
    if (!page) throw new Error('还没有可用的页面');
    ok = await page
      .waitForSelector('#ep-root', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      detail = await page.evaluate(() => {
        const bar = document.getElementById('ep-root')?.shadowRoot?.getElementById('ep-ext-bar');
        const box = bar?.getBoundingClientRect();
        return `${location.href}\n    工具条 ${box ? Math.round(box.width) + '×' + Math.round(box.height) : '缺失'}`;
      });
    }
    await browser.close().catch(() => {});
    if (!ok) await new Promise((r) => setTimeout(r, 800));
  } catch (err) {
    detail = String(err).split('\n')[0].slice(0, 120);
    await new Promise((r) => setTimeout(r, 800));
  }
}

if (ok) {
  console.log('[✓] 已验证：扩展注入成功，工具条在页面上。');
  console.log('    ' + detail);
} else {
  console.error('[x] 未能确认注入。最后一步的错误：' + detail);
  console.error('    若命令行里 load-extension 指向正确仍不生效，换一个载体试试：--browser <Edge 路径>');
  process.exitCode = 1;
}
