// 门禁 G1 · 人工确认同目录副本、依赖内联与 Chrome 下载回退。
//
// 第一次保存时选择沙盘所在文件夹；后续保存应更新同一份 `原名_改.html`。
// 若同目录写入不可用，保存会回退到 Chrome 下载；脚本会读取你指定的实际落点。
//
// 机器检查源 HTML 与依赖未变、文件名、内联内容及单文件打开表现；人工确认文件选择器、
// 权限提示、Chrome 下载提示和实际落点。副本拷到单文件目录后应保留本地静态内容。
//
// 用法（需要人在场，所以不走探针自动流程）：
//   npm run qa:g1          ← 已含 build:extension
//   或：
//   npm run build:extension && node qa/probes/p0-9-manual-copy-save.mjs

import { chromium } from 'playwright';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// 🔴 所有路径都以**脚本自身位置**为基准，不以当前工作目录为基准。
// 否则用户在主目录下敲命令会拼成 `C:\Users\<名>\dist-extension` —— 报「找不到夹具/扩展产物」，
// 看着像脚本坏了。（P0-5 版实测踩到：用户直接把命令粘在 `C:\Users\<名>` 下执行。）
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXT_DIR = resolve(REPO, 'dist-extension');
const WORK = resolve(REPO, 'test-results/g1');
/** 「拉出去分享」的模拟目的地：**只有副本这一个文件**的目录。 */
const ELSEWHERE = resolve(REPO, 'test-results/g1-elsewhere');
const PROFILE_DIR = resolve(REPO, 'test-results/g1-manual-profile');
const PROFILE_DIR_ELSEWHERE = resolve(REPO, 'test-results/g1-elsewhere-profile');

const FIRST_MARKER = 'G1-OK-1';
const MARKER = 'G1-OK-2';
const BASE_NAME = 'manual-page';
const PAGE = resolve(WORK, `${BASE_NAME}.html`);
/** 同目录副本与下载回退使用的文件名。 */
const COPY_NAME = `${BASE_NAME}_改.html`;
const DEP_NAMES = ['styles.css', 'app.js', 'fig.png', 'bg.png', 'assets/deep.png'];

/**
 * 1×1 PNG（透明）。用内联字面量而不是往仓库里塞二进制：夹具是沙盘，随手可重建。
 * 下面有 `pngSignatureOk` 自检 —— 如果这个字面量被谁改坏了，门禁应当在**开浏览器之前**
 * 就报出来，而不是让人对着「图片没加载」猜半天。
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const pngSignatureOk = (b) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/**
 * 沙盘页面：**四类依赖各一份**，因为它们在代码里走的是四条不同的内联分支 ——
 * `<link rel=stylesheet>`（含 css 内 `url()`）、`<script src>`、根目录 `<img src>`、
 * 子目录 `<img src>`。少一类，就有一整条分支只能靠单测（假 reader）背书。
 */
const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>G1 人工门禁沙盘 · 易页 P0-9</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="rail">
    <h1 id="brand">门禁沙盘</h1>
  </header>
  <main>
    <section class="card">
      <h2>要改的那一段</h2>
      <p id="explain">原文：打开这把锁的钥匙在门卫那儿。</p>
    </section>
    <section class="card">
      <h2>脚本</h2>
      <p id="tick">脚本还没跑起来。</p>
      <button id="btn" type="button">点我</button>
    </section>
    <section class="card">
      <h2>图片（一张在子目录）</h2>
      <img id="fig" src="fig.png" alt="根目录图" width="64" height="64">
      <img id="deep" src="assets/deep.png" alt="子目录图" width="64" height="64">
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>
`;

/** css 里放一个 `url()` —— 它证明「css 内的相对引用也按那个 css 文件的位置解析并内联」。 */
const CSS = `/* 门禁沙盘样式表。存在即有意义：它让「样式没跟过去 ⇒ 整页塌掉」可被复现。 */
:root { --brand: #165dff; }
body { margin: 0; font: 16px/1.7 system-ui, sans-serif; }
/* ↓ 这条断言实际验证的是「css 里的 url() 被替换成 data:」 */
.rail { background-image: url("bg.png"); background-repeat: no-repeat; }
#brand { color: var(--brand); }
.card { margin: 24px 32px; padding: 20px 24px; border: 1px solid #d8dee6; border-radius: 10px; }
`;

const JS = `// 门禁沙盘脚本：让 #tick 变文字，用来判别「内联脚本到底执行了没有」。
document.getElementById('tick').textContent = '脚本已跑起来。';
let n = 0;
document.getElementById('btn').addEventListener('click', () => {
  n += 1;
  document.getElementById('tick').textContent = '点了 ' + n + ' 次。';
});
`;

if (process.argv.includes('--check')) {
  console.log('门禁 G1 · 环境自检');
  console.log(`  脚本位置         ${HERE}`);
  console.log(`  项目根目录       ${REPO}`);
  console.log(`  扩展产物         ${EXT_DIR}  ${existsSync(EXT_DIR) ? '✓' : '✗ 缺'}`);
  console.log(`  沙盘目录         ${WORK}`);
  console.log(`  预期同目录副本   ${resolve(WORK, COPY_NAME)}`);
  console.log(`  「拉出去」模拟处 ${ELSEWHERE}`);
  console.log(`  1×1 PNG 字面量   ${pngSignatureOk(PNG_1X1) ? '✓ 签名正确' : '✗ 坏了'}`);
  console.log('  ⇒ 全部就绪，可去掉 --check 正式运行。');
  process.exit(pngSignatureOk(PNG_1X1) ? 0 : 1);
}

/**
 * 纯字节判据：**只看这份副本自己**，不碰文件系统。
 *
 * 抽成函数的唯一理由是能 `--self-test` 自测（见下）。这不是洁癖：
 * 这十几条正则在真人跑这一轮之前**一次都没被执行过**，
 * 万一某条写错（比如 `url("data:` 那里的引号），用户会白跑一趟人工流程，
 * 且会把 FAIL 读成「产品坏了」—— 那正是本项目最怕的那类假证据。
 */
function judgementsOnBytes(out) {
  return [
    ['没有 `<base>` 标签（页内锚点按副本本身解析）', !/<base\s/i.test(out)],
    ['🔴 没有 `file:///` 绝对引用（自包含副本里不该有改写痕迹）', !/file:\/\//i.test(out)],
    ['🔴 没有外链 css 残留（`href="styles.css"` 已消失）', !/href="styles\.css"/.test(out)],
    ['🔴 没有外链脚本残留（`src="app.js"` 已消失）', !/src="app\.js"/.test(out)],
    ['🔴 没有外链图片残留（根目录图 + 子目录图都消失了）', !/src="(?:assets\/)?(?:fig|deep)\.png"/.test(out)],
    ['🔴 css 里那个 `url("bg.png")` 也内联了', /url\("data:image\/png;base64,/.test(out)],
    [
      '🔴 至少 3 处 `data:image/png;base64,`（根图 + 背景图 + 子目录图）',
      (out.match(/data:image\/png;base64,/g) ?? []).length >= 3,
    ],
    ['css 内容真的进了 `<style>`（不是留了个空标签）', /<style[^>]*>[\s\S]*--brand/.test(out)],
    // 判「js 进来了」用的是「有一个**不带 src** 的 script，且它的内容里有 app.js 的特征串」。
    // 不拿沙盘里那句显示文案当特征（`脚本已跑起来` 与 `脚本还没跑起来` 只差一个字，
    // 改沙盘文案就可能让它恒真）—— 那是一类典型的假判据。
    ['js 内容真的进了内联 `<script>`', /<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?addEventListener/.test(out)],
    ['🔴 零 contenteditable 残留', !/contenteditable/i.test(out)],
    ['🔴 零 data-ep-* 残留', !/data-ep-/i.test(out)],
    ['🔴 宿主 #ep-root 已移除', !/id="ep-root"/.test(out)],
  ];
}

/**
 * 沙盘里除原 HTML、依赖和预期副本之外的文件。
 */
function extraFiles(dir) {
  const known = new Set([`${BASE_NAME}.html`, COPY_NAME, ...DEP_NAMES]);
  const out = [];
  const walk = (prefix) => {
    for (const e of readdirSync(resolve(dir, prefix || '.'), { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (!known.has(rel)) out.push(rel);
    }
  };
  walk('');
  return out;
}

// ── 自测：先在**开浏览器之前**证明判据本身是对的 ──
//
// 两个合成夹具，形状都照着产品真实产出来写：
//   · `good`    = 内联成功后的副本：一个 `<style>`（含 data: url）、一个内联 `<script>`、
//                 两张 data: 图片、没有 base、没有外链。 ⇒ **每一条判据都必须绿**。
//   · `partial` = 有依赖没内联进来：带绝对 file URL、外链和编辑器残留。
//                 ⇒ **每一条判据都必须红**。
//
// 用部分内联副本作为反例，分别确认内联判据会发现外链、绝对路径与编辑器残留。
if (process.argv.includes('--self-test')) {
  console.log('门禁 G1 · 判据自测（不需要人、不需要浏览器）\n');

  const good = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<style>:root { --brand: #165dff; }\n.rail { background-image: url("data:image/png;base64,AAA"); }</style>',
    '</head><body><h1 id="brand">门禁沙盘</h1>',
    '<img id="fig" src="data:image/png;base64,BBB">',
    '<img id="deep" src="data:image/png;base64,CCC">',
    '<p id="explain">改过：G1-OK</p>',
    '<script>document.getElementById("btn").addEventListener("click", function () {});</script>',
    '</body></html>',
  ].join('');

  const partial = [
    '<!DOCTYPE html><html><head><base href="file:///C:/proj/">',
    '<link rel="stylesheet" href="styles.css">',
    '<style>body { color: red }</style>',
    '</head><body contenteditable="true" data-ep-editing="true">',
    '<div id="ep-root"></div>',
    '<img id="fig" src="fig.png"><img id="deep" src="assets/deep.png">',
    // 这条代表未内联后仍指向源目录的资源。
    '<img id="abs" src="file:///C:/proj/bg.png">',
    '<p id="explain">改过：G1-OK</p>',
    '<script src="app.js"></script>',
    '</body></html>',
  ].join('');

  const goodJudged = judgementsOnBytes(good);
  const partialJudged = judgementsOnBytes(partial);

  let failed = 0;
  for (const [name, ok] of goodJudged) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  【合格副本：应当全绿】${name}`);
  }
  for (const [name, ok] of partialJudged) {
    if (ok) failed += 1; // 它**本应**红 —— 绿了说明这条判据没有判别力，等于白写
    console.log(`${ok ? 'FAIL' : 'PASS'}  【部分内联：应当全红】${name}`);
  }
  const total = goodJudged.length + partialJudged.length;
  console.log(`\n共 ${total} 项，通过 ${total - failed}，失败 ${failed}`);
  if (failed) {
    console.log('\n判据本身不对 —— 先修 `judgementsOnBytes`，别去跑人工流程。');
    process.exit(1);
  }
  console.log('✅ 判据有判别力（合格副本全绿、部分内联全红），可以开始人工流程。');
  process.exit(0);
}

if (!existsSync(EXT_DIR)) {
  console.error(
    `[x] 缺少扩展产物：${EXT_DIR}\n` +
      `    先在项目根目录跑一次构建：\n` +
      `      cd "${REPO}"\n` +
      `      npm run build:extension\n` +
      `    或直接用 npm 脚本一步到位： npm run qa:g1`,
  );
  process.exit(1);
}

// 🔴 夹具坏掉必须在**开浏览器之前**报出来：否则会变成「图片没加载」这种要人猜的现象。
if (!pngSignatureOk(PNG_1X1)) {
  console.error('[x] 内置 1×1 PNG 字面量坏了（签名不对）—— 修夹具，别改判据。');
  process.exit(1);
}

// ── 重新生成隔离沙盘 ──
for (const dir of [WORK, ELSEWHERE]) rmSync(dir, { recursive: true, force: true });
mkdirSync(resolve(WORK, 'assets'), { recursive: true });
mkdirSync(ELSEWHERE, { recursive: true });

writeFileSync(PAGE, PAGE_HTML, 'utf8');
writeFileSync(resolve(WORK, 'styles.css'), CSS, 'utf8');
writeFileSync(resolve(WORK, 'app.js'), JS, 'utf8');
for (const name of ['fig.png', 'bg.png']) writeFileSync(resolve(WORK, name), PNG_1X1);
writeFileSync(resolve(WORK, 'assets/deep.png'), PNG_1X1);

// 依赖的「改动前」基线：我们仍要**读**它们来内联，读坏了同样是不可接受的回归。
const before = new Map();
for (const rel of [`${BASE_NAME}.html`, ...DEP_NAMES]) {
  const abs = resolve(WORK, rel);
  before.set(rel, { bytes: readFileSync(abs), mtime: statSync(abs).mtimeMs });
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 900 },
});

const page = await ctx.newPage();
const toUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
await page.goto(toUrl(PAGE));
await page.waitForSelector('#ep-root', { timeout: 15_000 }).catch(() => {});

if ((await page.locator('#ep-root').count()) === 0) {
  console.error('[x] 扩展没注入进来（#ep-root 不存在）—— 换载体再试，见 scripts/open-with-easypage.mjs');
  await ctx.close();
  process.exit(1);
}

// 前提自检：沙盘本身在原目录里必须是**能跑**的，否则后面「拷出去坏了」说明不了任何事。
const preTick = await page.locator('#tick').textContent().catch(() => '');
const preColor = await page.locator('#brand').evaluate((el) => getComputedStyle(el).color).catch(() => '');
if (!preTick.includes('脚本已跑起来') || preColor !== 'rgb(22, 93, 255)') {
  console.error(
    `[x] 沙盘前提不成立：在原目录里就不正常（#tick="${preTick}" #brand.color=${preColor}）。\n` +
      '    先修沙盘 —— 前提错了，后面所有「内联成功」的结论都不成立。',
  );
  await ctx.close();
  process.exit(1);
}

console.log(`
══════════ 门禁 G1 · 人工确认同目录副本与下载回退 ══════════

 沙盘原文件：${PAGE}
 首次保存时请选择源文件所在文件夹：${WORK}
 预期副本名：${COPY_NAME}

 请在弹出的浏览器里依次操作：

   ① 点「编辑模式」，双击说明文字，把它改成含 ${FIRST_MARKER} 的内容并按 Enter
   ② 点「另存为副本」

      ▸ 首次会提示选择源文件夹，请选：
            ${WORK}
      ▸ 如果 Chrome 请求读写权限，请按提示处理
      ▸ 有写权限时副本落在沙盘目录；写入不可用时会交给 Chrome 下载

   ③ 把说明文字更新为含 ${MARKER} 的内容并按 Enter，再点一次「另存为副本」

      ▸ 同目录路线应更新同一个 ${COPY_NAME}；下载回退路线可能产生带序号的第二份

 请人工确认：
    · 目录选择前的提示说明了用途，且选中的是源 HTML 所在文件夹
    · 页面提示与实际落点一致；Chrome 下载回退时下载记录能找到副本
    · 保存只改动副本，原 HTML 与其依赖保持不变
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));
const outputDirInput = await ask(
  `完成后回到终端按回车；若走 Chrome 下载回退，请粘贴副本所在文件夹路径… `,
);
rl.close();
const OUTPUT_DIR = resolve(outputDirInput.trim() || WORK);
const DOWNLOAD_FALLBACK = OUTPUT_DIR.toLowerCase() !== WORK.toLowerCase();
const OUT_PAGE = resolve(OUTPUT_DIR, COPY_NAME);
const OUT_PAGE_2 = resolve(OUTPUT_DIR, `${BASE_NAME}_改 (1).html`);
const LATEST_PAGE = DOWNLOAD_FALLBACK ? OUT_PAGE_2 : OUT_PAGE;

// ════════════ 第一段：读盘校验（实际落点 + 沙盘目录）════════════
const outExists = existsSync(OUT_PAGE);
const out2Exists = DOWNLOAD_FALLBACK && existsSync(OUT_PAGE_2);
const out = outExists ? readFileSync(OUT_PAGE, 'utf8') : '';
const out2 = out2Exists ? readFileSync(OUT_PAGE_2, 'utf8') : '';
const latestOut = DOWNLOAD_FALLBACK ? out2 : out;

const untouched = [...before.entries()].map(([rel, b]) => {
  const abs = resolve(WORK, rel);
  if (!existsSync(abs)) return [`🔴 ${rel} 还在（没被删掉）`, false];
  const same = Buffer.compare(b.bytes, readFileSync(abs)) === 0;
  const sameTime = statSync(abs).mtimeMs === b.mtime;
  return [`🔴 ${rel} 逐字节未变（含 mtime）`, same && sameTime];
});
const directCopyExists = existsSync(resolve(WORK, COPY_NAME));

const fsChecks = [
  ...untouched,
  [`原文件里没有输入标记（改动没落回原文件）`, ![FIRST_MARKER, MARKER].some((s) => before.get(`${BASE_NAME}.html`).bytes.toString('utf8').includes(s))],
  ['沙盘目录中除原文件、依赖与预期副本外没有额外文件', extraFiles(WORK).length === 0],
  [`副本落点符合所选路线（${DOWNLOAD_FALLBACK ? 'Chrome 下载回退' : '源文件夹'}）`, DOWNLOAD_FALLBACK ? !directCopyExists : directCopyExists],
  [`实际落点里有 ${COPY_NAME}`, outExists],
  [`${DOWNLOAD_FALLBACK ? '下载回退生成第二份序号文件' : '同目录保存未生成额外副本'}`, DOWNLOAD_FALLBACK ? out2Exists : !out2Exists],
  [`最新副本含第二次编辑的「${MARKER}」（证明同名副本已更新）`, latestOut.includes(MARKER)],
  [`下载回退的首份保留第一次编辑的「${FIRST_MARKER}」`, !DOWNLOAD_FALLBACK || out.includes(FIRST_MARKER)],
  // 自包含那一组（11 条）抽在 `judgementsOnBytes` 里 —— 于是它能被 `--self-test` 单独验，
  // 不必等真人跑完一轮才知道判据写没写对。
  ...judgementsOnBytes(latestOut),
];

console.log(`\n────────── 读盘校验（${DOWNLOAD_FALLBACK ? 'Chrome 下载回退' : '源文件夹'} + 沙盘目录）──────────`);
let failed = 0;
for (const [name, ok] of fsChecks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

// ════════════ 第二段：把副本单独拷到别处（用户那句「可以直接拉出去被分享」）════════════
console.log('\n────────── 拷到只有它的文件夹里，重新打开 ──────────');

let runtime = [];
if (!existsSync(LATEST_PAGE)) {
  console.log('SKIP  指定落点里没有副本，这一段无从谈起');
} else {
  // 两个文件夹都只放**一个** html：被验的那个 + 反向确认用的原文件（各自独立目录）。
  const ONLY_DIR = resolve(ELSEWHERE, 'only-copy');
  const RAW_DIR = resolve(ELSEWHERE, 'only-original');
  mkdirSync(ONLY_DIR, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });
  const copied = resolve(ONLY_DIR, 'shared.html');
  const rawCopied = resolve(RAW_DIR, 'raw.html');
  copyFileSync(LATEST_PAGE, copied);
  copyFileSync(PAGE, rawCopied);

  const probe = async (file) => {
    await page.goto('about:blank');
    await page.goto(toUrl(file));
    await page.waitForTimeout(500);
    return {
      tick: await page.locator('#tick').textContent().catch(() => null),
      color: await page.locator('#brand').evaluate((el) => getComputedStyle(el).color).catch(() => null),
      fig: await page.locator('#fig').evaluate((el) => el.naturalWidth).catch(() => -1),
      deep: await page.locator('#deep').evaluate((el) => el.naturalWidth).catch(() => -1),
      explain: await page.locator('#explain').textContent().catch(() => ''),
      base: await page.evaluate(() => document.baseURI).catch(() => ''),
    };
  };

  const copy = await probe(copied);
  const raw = await probe(rawCopied);

  runtime = [
    // ── 正向：副本必须**全部照常** ──
    [`🔴 内联 js 执行了（#tick = 「${copy.tick}」）`, !!copy.tick && copy.tick.includes('脚本已跑起来')],
    [`🔴 内联 css 生效（#brand.color = ${copy.color}）`, copy.color === 'rgb(22, 93, 255)'],
    [`🔴 根目录图内联成功（naturalWidth = ${copy.fig}）`, copy.fig === 1],
    [`🔴 **子目录**图内联成功（naturalWidth = ${copy.deep}）`, copy.deep === 1],
    [`🔴 改动仍在（#explain 含「${MARKER}」）`, copy.explain.includes(MARKER)],
    // ── 反向确认：原文件同样拷过去，必须**立刻坏掉** ──
    // 否则说明「拷出去还能用」是这个环境的天赋，与本方案无关 —— 那这一整段就什么都没证明。
    [
      `🔴 反向确认：原文件拷过去就断了（#tick 仍是「${String(raw.tick).slice(0, 10)}…」）`,
      !!raw.tick && !raw.tick.includes('脚本已跑起来'),
    ],
    [`🔴 反向确认：原文件拷过去 css 也丢了（#brand.color = ${raw.color}）`, raw.color !== 'rgb(22, 93, 255)'],
  ];
}

for (const [name, ok] of runtime) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

const total = fsChecks.length + runtime.length;
console.log(`\n共 ${total} 项，通过 ${total - failed}，失败 ${failed}`);
if (failed) {
  console.log('\n若是「原文件或依赖被改动」失败，请检查保存是否写到了错误的文件夹。');
  console.log('若是「实际落点没有副本」失败，请按页面 toast 与 Chrome 下载记录确认副本路径。');
  console.log('若是「有 base / 有外链残留」失败，请检查依赖内联提示与源文件夹读取权限。');
  console.log('若是「拷出去不能用」失败：副本并不自包含。');
  console.log('若是「反向确认」失败：先怀疑沙盘，而不是先怀疑产品（原文件拷过去本来就该坏）。');
}

await ctx.close();
if (failed) process.exitCode = 1;
