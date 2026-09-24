// 门禁 G1 · 人工确认「另存到 `_改/`」（07 §8）
//
// ── 为什么必须人手执行 ──
// 「原生目录框弹出 → 用户选定目录 → 浏览器建目录并写盘」这一环里，**没有一步是我们的代码**：
// 目录框是 OS 级窗口，Playwright 触不到；CDP 也没有可编程的「替用户点确认」通道。
// 探针 `directory-copy-capability.mjs` 能证明到「框确实会弹出来、在等人」（promise 未决）
// 为止，再往后只能由人手完成。
//
// ── 这个脚本把「人手」压缩成两件事 ──
//   ① 改几个字（让另存有内容可验）
//   ② 在原生目录框里选中**脚本给的那个目录**
// 其余全部自动：起浏览器、装扩展、造一份**不会污染仓库夹具**的副本、
// 等你在终端按一下回车、然后**读盘校验**。
//
// ── 🔴 最要紧的一条断言 ──
// **原文件逐字节未变**（连同 mtime）。这是整个形态转向的意义所在，所以这里比的是
// 字节缓冲，不是「内容看着差不多」。
//
// ── 第二要紧的一条 ──
// 重新打开 `_改/manual-page.html` 时，**依赖仍然可用**：`#tick` 被 app.js 改写、
// `#h` 被 styles.css 上色。这两条同时成立，才说明那一行 `<base href="../">` 真的
// 把相对 URL 拉回了原目录 —— 这是 base 方案在实践里的唯一证据。
//
// 用法（需要人在场，所以不走探针自动流程）：
//   npm run build:extension
//   node qa/probes/p0-8-manual-dir-save.mjs

import { chromium } from 'playwright';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// 🔴 所有路径都以**脚本自身位置**为基准，不以当前工作目录为基准。
// 否则用户在主目录下敲命令会拼成 `C:\Users\<名>\dist-extension` —— 报「找不到夹具/扩展产物」，
// 看着像脚本坏了。（P0-5 版实测踩到：用户直接把命令粘在 `C:\Users\Administrator>` 下执行。）
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXT_DIR = resolve(REPO, 'dist-extension');
const FIXTURE_DIR = resolve(REPO, 'qa/fixtures/multi-file');
const WORK = resolve(REPO, 'test-results/g1');
const PROFILE_DIR = resolve(REPO, 'test-results/p0-8-manual-profile');
const MARKER = 'G1-OK';

/**
 * 副本要连**依赖**一起复制过来：只有本目录下真有 `styles.css` / `app.js`，
 * 才能验出「另存到子目录后依赖还找得到」这件事。缺了它们，这一整轮就退化成
 * 「验了一份单文件页面」，而 base 方案的价值恰恰在多文件上。
 */
const FILES = ['styles.css', 'app.js'];
const PAGE = resolve(WORK, 'manual-page.html');
const OUT_DIR = resolve(WORK, '_改');
const OUT_PAGE = resolve(OUT_DIR, 'manual-page.html');
/** 原目录里必须**没有**的东西（依赖不复制 —— 靠 base 指回原处）。 */
const OUT_MUST_NOT_HAVE = ['styles.css', 'app.js'];

if (process.argv.includes('--check')) {
  console.log('门禁 G1 · 环境自检');
  console.log(`  脚本位置       ${HERE}`);
  console.log(`  项目根目录     ${REPO}`);
  console.log(`  扩展产物       ${EXT_DIR}  ${existsSync(EXT_DIR) ? '✓' : '✗ 缺'}`);
  console.log(`  夹具目录       ${FIXTURE_DIR}  ${existsSync(FIXTURE_DIR) ? '✓' : '✗ 缺'}`);
  console.log(`  待另存副本     ${PAGE}`);
  console.log(`  预期输出目录   ${OUT_DIR}`);
  console.log(`  浏览器 profile ${PROFILE_DIR}`);
  console.log('  ⇒ 路径全部就绪，可去掉 --check 正式运行。');
  process.exit(0);
}

if (!existsSync(FIXTURE_DIR)) {
  console.error(`[x] 缺少夹具目录：${FIXTURE_DIR}`);
  process.exit(1);
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

mkdirSync(WORK, { recursive: true });
// 清掉上一轮留下的 `_改/`：本轮要**从无到有**地验它被创建出来。
// （只有本轮该有的产物，数量极少；不用通配符，避免误伤。）
rmSync(OUT_DIR, { recursive: true, force: true });

copyFileSync(resolve(FIXTURE_DIR, 'index.html'), PAGE);
for (const f of FILES) copyFileSync(resolve(FIXTURE_DIR, f), resolve(WORK, f));

const beforeBytes = readFileSync(PAGE);
const beforeMtime = statSync(PAGE).mtimeMs;

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 860 },
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

console.log(`
══════════ 门禁 G1 · 人工确认「另存到 _改/」══════════

 原文件（**全程不该被改动**）：${PAGE}
 预期输出：${OUT_PAGE}

 请在弹出的浏览器里依次做三件事：

   ① 点工具条的「编辑模式」（铅笔）
   ② 双击 <p>「真实事故：一份三件套站点…」那段，改成含 ${MARKER} 的字样，按 Enter
   ③ 点「另存到 _改」（下载图标）→ 在弹出的**目录选择框**里选中这个目录，确认：

        ${WORK}

      （目录框里可以直接把上面这行路径粘到地址栏）

 提示：默认情况下目录框不会停在这个目录 —— 浏览器不允许我们指定起始位置。
      但**只需要选这一次**：之后扩展会记住它，再点保存就不再弹框。
      （可选验证：完成后再点一次「另存到 _改」，若不再弹框，说明目录已被记住。）
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
await new Promise((res) => rl.question('完成后回到终端按回车，我来读盘校验 … ', res));
rl.close();

// ── 读盘校验 ──
const afterBytes = readFileSync(PAGE);
const afterMtime = statSync(PAGE).mtimeMs;
const sameBytes = Buffer.compare(beforeBytes, afterBytes) === 0;
const outExists = existsSync(OUT_PAGE);
const out = outExists ? readFileSync(OUT_PAGE, 'utf8') : '';

const checks = [
  ['🔴 原文件**逐字节未变** —— 这是「不覆写」的全部意义', sameBytes],
  ['🔴 原文件的修改时间也没变（没被重写过一遍）', afterMtime === beforeMtime],
  [`🔴 原文件里**没有**你输入的「${MARKER}」（改动没落回原文件）`, !afterBytes.toString('utf8').includes(MARKER)],
  ['`_改/` 文件夹被创建出来了', existsSync(OUT_DIR)],
  ['`_改/manual-page.html` 存在', outExists],
  [`新文件里含你输入的「${MARKER}」（改动确实保存了）`, out.includes(MARKER)],
  ['新文件里插入了 `<base href="../">`', out.includes('<base href="../">')],
  ['🔴 零 contenteditable 残留', !/contenteditable/i.test(out)],
  ['🔴 零 data-ep-* 残留', !/data-ep-/i.test(out)],
  ['🔴 宿主 #ep-root 已移除', !/id="ep-root"/.test(out)],
  ['页面自己的 `<script src="app.js">` 仍在（引用没被改写）', /<script src="app\.js">/.test(out)],
  ['页面自己的 `<link href="styles.css">` 仍在（引用没被改写）', /href="styles\.css"/.test(out)],
  ...OUT_MUST_NOT_HAVE.map((f) => [
    `🔴 依赖 ${f} **没有**被复制进 \`_改/\`（依赖留在原处，靠 base 指回）`,
    !existsSync(resolve(OUT_DIR, f)),
  ]),
];

console.log('\n────────── 读盘校验（文件系统）──────────');
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

// ── 关键一环：重新打开副本，依赖还找得到吗 ──
// 这一节才是 base 方案在实践里的唯一证据。上面那些字节断言只说明「写对了位置」，
// 说明不了「打开还正常」。
console.log('\n────────── 重新打开副本（依赖是否仍可用）──────────');
await page.goto('about:blank');
await page.goto(toUrl(OUT_PAGE));
await page.waitForTimeout(400);

const tick = await page.locator('#tick').textContent().catch(() => null);
const hColor = await page
  .locator('#h')
  .evaluate((el) => getComputedStyle(el).color)
  .catch(() => null);
const explain = await page.locator('#explain').textContent().catch(() => '');
const baseURI = await page.evaluate(() => document.baseURI).catch(() => '');

const runtime = [
  ['documents.baseURI 指回了原目录', baseURI.endsWith('/g1/'), baseURI],
  ['`#tick` 被 app.js 改写（=> 上层目录的 js 加载成功）', !!tick && tick.includes('脚本已跑起来'), tick],
  ['`#h` 被 styles.css 上色（=> 上层目录的 css 生效）', hColor === 'rgb(22, 93, 255)', hColor],
  [`改动仍在（#explain 含「${MARKER}」）`, explain.includes(MARKER), explain.slice(0, 60)],
];

for (const [name, ok, detail] of runtime) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}

const total = checks.length + runtime.length;
console.log(`\n共 ${total} 项，通过 ${total - failed}，失败 ${failed}`);
if (failed) {
  console.log('\n若是「原文件被改了」失败：那说明写盘路径走错了，是**严重回归**，请立刻停手排查。');
  console.log('若是目录相关失败：多半是第 ③ 步选的目录不是上面给的那个。');
}

await ctx.close();
if (failed) process.exitCode = 1;
