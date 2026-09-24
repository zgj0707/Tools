// `<base href="../">` 能否让「另存到子目录的 html」保持原目录依赖仍可用？
//
// 背景：用户指出「html 对依赖文件本来就有引用，改一下引用路径就行」。
// 顺着这个思路，比逐个改写引用更完备的做法是插一行 `<base>` —— 它一次性改变
// **页面上所有相对 URL 的解析基准**，包括我们静态扫描不到的（js 里动态拼的请求）。
//
// 但这两点必须实测，不能凭标准文档下结论：
//   ① `file://` 下从子目录用 `../` 加载上层目录的 css / js / 图片，是否真的可行；
//   ② `<base>` 会不会带来副作用（页内 `#锚点` 会解析到哪）。
//
// 结构（`test-results/probe-base/`）：
//   proj/styles.css · app.js · fig1.png · bg.png · data.json   ← 原目录的依赖，全程不动
//   proj/_改/with-base.html      ← 带 <base href="../">
//   proj/_改/without-base.html   ← 反向确认：不带 base，应当**坏掉**
//
// 反向确认那一份是刻意的：若两种都「能用」，说明 base 根本不是起作用的那个因，
// 那结论就站不住脚（警示恒真就等于没有）。
//
// 用法：node qa/probes/base-href-capability.mjs

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PROJ = join(REPO, 'test-results', 'probe-base', 'proj');
const SUB = join(PROJ, '_改');
const OUT_DIR = join(REPO, 'test-results', 'capability');
mkdirSync(SUB, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// 1×1 透明 PNG —— 只为让「图片是否真的加载成功」有个可读的判据（naturalWidth > 0）。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ── 原目录的依赖：全程不动，模拟「用户的 styles.css / app.js」──
writeFileSync(join(PROJ, 'styles.css'), '#h { color: rgb(22, 93, 255); }\n', 'utf8');
writeFileSync(
  join(PROJ, 'app.js'),
  "document.getElementById('tick').textContent = '脚本已跑起来';\n",
  'utf8',
);
writeFileSync(join(PROJ, 'fig1.png'), PNG);
writeFileSync(join(PROJ, 'bg.png'), PNG);
writeFileSync(join(PROJ, 'data.json'), '{"probe":"data-marker"}\n', 'utf8');

// ── 另存到子目录的那一份。`base` 为空串时输出「不带 base」的对照组 ──
const SAVED = (base) => `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
${base}
<link rel="stylesheet" href="styles.css">
<style>#inlineBg { background-image: url(bg.png); width: 4px; height: 4px; }</style>
</head><body>
<h1 id="h">base probe</h1>
<p id="tick">脚本还没跑起来。</p>
<img id="pic" src="fig1.png" alt="">
<div id="inlineBg"></div>
<a id="anchor" href="#top">anchor</a>
<script src="app.js"></script>
</body></html>`;

writeFileSync(join(SUB, 'with-base.html'), SAVED('<base href="../">'), 'utf8');
writeFileSync(join(SUB, 'without-base.html'), SAVED(''), 'utf8');

const urlOf = (name) => pathToFileURL(join(SUB, name)).href;

const MEASURE = () => {
  const h = document.getElementById('h');
  const tick = document.getElementById('tick');
  const pic = document.getElementById('pic');
  const anchor = document.getElementById('anchor');
  const inlineBg = document.getElementById('inlineBg');
  const link = document.querySelector('link[rel~="stylesheet"]');
  const resolveTo = (u) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return null;
    }
  };
  return {
    href: location.href,
    baseURI: document.baseURI,
    // 样式是否真的生效（不是「css 文件能否被 fetch」—— 那是另一回事）
    hColor: getComputedStyle(h).color,
    // 脚本是否真的执行
    tick: tick.textContent,
    // 图片是否真的加载成功
    picW: pic.naturalWidth,
    picResolved: pic.src,
    // 内联 style 的 url() 会去哪（背景图读不到 naturalWidth，只能看解析结果）
    inlineBgResolved: (() => {
      const bg = getComputedStyle(inlineBg).backgroundImage;
      const m = /url\(["']?(.*?)["']?\)/.exec(bg);
      return m ? m[1].slice(-60) : bg.slice(0, 60);
    })(),
    // 🔴 副作用观察点：页内 `#锚点` 会解析到哪里
    anchorResolved: anchor.href,
    // 页面上任何 `fetch('data.json')` 这类**相对文档**的动态请求会去哪
    dynamicResolved: resolveTo('data.json'),
    // 规则文本能否读（无 --allow-file-access-from-files 时应为 SecurityError；不影响样式生效）
    sheetRules: (() => {
      try {
        return link.sheet ? link.sheet.cssRules.length : null;
      } catch (e) {
        return `err:${e.name}`;
      }
    })(),
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));

const out = {};
for (const name of ['with-base.html', 'without-base.html']) {
  await page.goto(urlOf(name));
  await page.waitForTimeout(250);
  out[name] = await page.evaluate(MEASURE);
}
out.pageErrors = errors;
await ctx.close();
await browser.close();

writeFileSync(join(OUT_DIR, 'base-href-capability.json'), JSON.stringify(out, null, 2), 'utf8');

const results = [];
const check = (name, fn) => {
  try {
    results.push({ name, ok: true, detail: String(fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 200) });
  }
};
const withBase = out['with-base.html'];
const without = out['without-base.html'];

check('带 base：css 生效（说明从子目录用 ../ 加载上层 css 可行）', () => {
  if (withBase.hColor !== 'rgb(22, 93, 255)') throw new Error(`hColor = ${withBase.hColor}`);
  return withBase.hColor;
});
check('带 base：js 执行（从子目录加载上层 js 可行）', () => {
  if (!withBase.tick.includes('脚本已跑起来')) throw new Error(`tick = ${withBase.tick}`);
  return withBase.tick;
});
check('带 base：图片加载成功（naturalWidth > 0）', () => {
  if (!(withBase.picW > 0)) throw new Error(`naturalWidth = ${withBase.picW}`);
  return `naturalWidth=${withBase.picW}`;
});
check('🔴 反向确认：不带 base 时这三样**全部坏掉**（否则 base 不是起作用的那个因）', () => {
  const bad = [];
  if (without.hColor === 'rgb(22, 93, 255)') bad.push('css 竟然生效了');
  if (without.tick.includes('脚本已跑起来')) bad.push('js 竟然执行了');
  if (without.picW > 0) bad.push('图片竟然加载了');
  if (bad.length) throw new Error(bad.join('、'));
  return `hColor=${without.hColor} tick=${without.tick} picW=${without.picW}`;
});

console.log('\n══════════ <base href="../"> 能力探针 ══════════');
console.log(`另存位置：${urlOf('with-base.html')}`);
console.log(`原目录  ：${pathToFileURL(PROJ).href}\n`);

for (const [label, r] of [
  ['带 base', withBase],
  ['不带 base（对照）', without],
]) {
  console.log(`── ${label} ──`);
  console.log(`  document.baseURI   : ${r.baseURI}`);
  console.log(`  css 生效(hColor)   : ${r.hColor}`);
  console.log(`  js 执行(tick)      : ${r.tick}`);
  console.log(`  图片(naturalWidth) : ${r.picW}`);
  console.log(`  img 解析后 URL     : ${r.picResolved.slice(-50)}`);
  console.log(`  内联 style url()   : ${r.inlineBgResolved}`);
  console.log(`  #锚点 解析后       : ${r.anchorResolved.slice(-50)}`);
  console.log(`  fetch('data.json') : ${r.dynamicResolved.slice(-50)}`);
  console.log(`  cssRules 可读性    : ${r.sheetRules}\n`);
}
if (out.pageErrors.length) console.log(`页面错误：${out.pageErrors.slice(0, 3).join(' | ')}\n`);

console.log('── 断言明细 ──');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
console.log(`\nJSON → ${join(OUT_DIR, 'base-href-capability.json')}\n`);
