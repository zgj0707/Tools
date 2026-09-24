// 门禁 G1 · 人工确认写回原文件（07 §8）
//
// ── 为什么必须人手执行 ──
// 「原生保存框弹出 → 用户选定文件 → 浏览器写盘」这一环里，**没有一步是我们的代码**：
// 前端对话框是 OS 级窗口，Playwright 触不到；CDP 也没有可编程的「替用户点确认」通道。
// 探针 `extension-p0-4.mjs` 能证明到「框弹出来了、在等人」（`aria-busy=true`）为止，
// 再往后只能由人手完成。
//
// ── 这个脚本把「人手」压缩成两件事 ──
//   ① 改几个字（让写回有内容可验）
//   ② 在原生框里选**脚本给的那份文件**、确认覆盖
// 其余全部自动：起浏览器、装扩展、造一份**不会污染仓库夹具**的副本、
// 等你在终端按一下回车、然后**读盘校验写回结果**。
//
// 用法（需要人在场，所以不走探针自动流程）：
//   npm run build:extension
//   node qa/probes/p0-5-manual-writeback.mjs

import { chromium } from 'playwright';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// 🔴 所有路径都以**脚本自身位置**为基准，不以当前工作目录为基准。
// 否则用户在主目录下敲 `node qa/probes/p0-5-manual-writeback.mjs` 会拼成
// `C:\Users\<名>\dist-extension` —— 报「找不到夹具/扩展产物」，看着像脚本坏了。
// （实测踩到：用户直接把命令粘在 `C:\Users\Administrator>` 下执行。）
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const EXT_DIR = resolve(REPO, 'dist-extension');
const FIXTURE = resolve(REPO, 'qa/fixtures/pick-page.html');
const WORK_DIR = resolve(REPO, 'test-results/g1');
/** 副本放在 test-results 而不是 qa/fixtures：写回会改文件内容，不能污染入库的夹具。 */
const TARGET = resolve(WORK_DIR, 'manual-page.html');
const PROFILE_DIR = resolve(REPO, 'test-results/p0-5-manual-profile');
const MARKER = 'G1-OK';

if (!existsSync(FIXTURE)) {
  console.error(`[x] 缺少夹具：${FIXTURE}`);
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

// `--check`：只自检环境与路径，不启动浏览器。用来回答「为什么它说找不到文件」——
// 路径全部按**脚本位置**解析，所以这个自检在任何工作目录下都应给出同一组路径。
if (process.argv.includes('--check')) {
  console.log('门禁 G1 · 环境自检');
  console.log(`  脚本位置      ${HERE}`);
  console.log(`  项目根目录    ${REPO}`);
  console.log(`  扩展产物      ${EXT_DIR}`);
  console.log(`  夹具          ${FIXTURE}`);
  console.log(`  待写回副本    ${TARGET}`);
  console.log(`  浏览器 profile ${PROFILE_DIR}`);
  console.log('  ⇒ 路径全部就绪，可去掉 --check 正式运行。');
  process.exit(0);
}

mkdirSync(WORK_DIR, { recursive: true });
copyFileSync(FIXTURE, TARGET);
const before = readFileSync(TARGET, 'utf8');

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  channel: undefined,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 860 },
});

const page = await ctx.newPage();
await page.goto(`file:///${TARGET.replace(/\\/g, '/')}`);
await page.waitForSelector('#ep-root', { timeout: 15_000 }).catch(() => {});

if ((await page.locator('#ep-root').count()) === 0) {
  console.error('[x] 扩展没注入进来（#ep-root 不存在）—— 换载体再试，见 scripts/open-with-easypage.mjs');
  await ctx.close();
  process.exit(1);
}

console.log(`
══════════ 门禁 G1 · 人工写回确认 ══════════

 待写回的文件：${TARGET}

 请在弹出的浏览器里依次做三件事：

   ① 点工具条的「编辑模式」（铅笔）
   ② 双击页面里任意一段文字，把内容改成包含 ${MARKER} 的字样，按 Enter
   ③ 点「保存到原文件」（下载图标）→ 在原生框里选中上面那个文件 → 确认覆盖

 提示：原生框的默认文件名已经是 manual-page.html，选同一目录直接覆盖即可。
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
await new Promise((res) => rl.question('完成后回到终端按回车，我来读盘校验 … ', res));
rl.close();

const after = readFileSync(TARGET, 'utf8');
const checks = [
  ['文件被改写了（内容不等于原夹具）', after !== before],
  [`写入了你输入的标记「${MARKER}」`, after.includes(MARKER)],
  ['保留 <!DOCTYPE html>', /^\s*<!DOCTYPE html>/i.test(after)],
  ['🔴 零 contenteditable 残留', !/contenteditable/i.test(after)],
  ['🔴 零 data-ep-* 残留', !/data-ep-/i.test(after)],
  ['🔴 宿主 #ep-root 已移除', !/id="ep-root"/.test(after)],
  ['原有行内 <strong> 仍在（改字没把行内格式写丢）', /<strong/i.test(after)],
  ['页面自己的 <script> 仍在', /document\.getElementById\('btn'\)/.test(after)],
];

console.log('\n────────── 读盘校验 ──────────');
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(`\n共 ${checks.length} 项，通过 ${checks.length - failed}，失败 ${failed}`);

// 用浏览器重新打开写回后的文件 —— 「改完还是那份 HTML」的最终确认。
await page.goto('about:blank');
await page.goto(`file:///${TARGET.replace(/\\/g, '/')}`);
const seen = await page.locator('#para').textContent().catch(() => null);
console.log(`重新打开页面，#para 读到：「${(seen ?? '').slice(0, 60)}」`);
console.log(
  seen && seen.includes(MARKER)
    ? 'PASS  重新打开后改动仍在（写回闭环成立）'
    : 'FAIL  重新打开后读不到改动',
);

await ctx.close();
if (failed) process.exitCode = 1;
