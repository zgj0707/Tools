// P0-7 / P0-9 验收探针：多文件页面防护 —— 依赖侦测 + 常驻提示。
//
// ── 这个探针覆盖什么、不覆盖什么（必须写明，否则会被当成「全验过了」）──
// ✅ 覆盖「**提示**」这一半：在真实 Chromium 里加载扩展，打开一份**真的**依赖同目录文件
//    的页面，读保存按钮的 `title`。为什么必须走真浏览器：依赖侦测读的是真实 DOM 的
//    `href`/`src` 属性，而「按钮的 title 到底写成什么」还要经过 bar 的状态机
//    （依赖信息要跨多次 setSaveState 活着）。
// ❌ **不覆盖**「**真正落盘**」那一半：另存要经过 OS 级原生目录/保存对话框，
//    Playwright 与 CDP 都碰不到（P0-5 已实测；P0-8 又实测了目录框确实会弹出、
//    但拿不到真句柄）。所以「记住目录 ⇒ 下次不弹框」「写进原目录」只能靠人手门禁 G1
//    复验。本探针**不假装**测过它。
// ❌ 也**不覆盖**「内联有没有真的生效」—— 那要能读到原文件的字节，同样要真句柄。
//    内联本身由 `tests/unit/extension-inline-deps.test.ts`（纯函数 + 假 reader）与
//    `qa/probes/selfcontain-capability.mjs`（真浏览器里量「拷到别处还能不能用」）守。
//
// ⚠️ 口径改过两次，本文件的断言跟着改了两次（改文案时必须回这里搜，否则会误判成产品回归）：
//    · P0-8：形态从「就地覆写」改为「旁路另存到 `_改/`」—— 依赖从「必须跟走」的**警告**
//      变成「不复制、仍从原目录读取」的**告知**；
//    · **P0-9**：落点从 `_改/` 子文件夹改为**同目录 `原名_改.html`**，且依赖**会被内联进副本**
//      —— 于是「报出的目录」从 `_改/` 的路径变回**原目录**，「依赖会被怎么处理」也从
//      「不复制」反转成「内联进副本，可单独分享」。
//
// 前置：必须 headed + launchPersistentContext + --load-extension。
// 用法：node qa/probes/extension-p0-7.mjs   （需先 npm run build:extension）

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSER = process.env.EP_PROBE_BROWSER || undefined;
const EXT_DIR = resolve('dist-extension');
const MULTI = resolve('qa/fixtures/multi-file/index.html');
const SINGLE = resolve('qa/fixtures/pick-page.html');
const PROFILE_DIR = resolve('test-results/p0-7-profile');

for (const p of [MULTI, SINGLE]) {
  if (!existsSync(p)) {
    console.error(`[x] 缺少夹具: ${p}`);
    process.exit(1);
  }
}
mkdirSync(resolve('test-results'), { recursive: true });

const toUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
/**
 * 夹具所在目录的 Windows 形态（与 `directoryOf` 的显示口径一致）。
 *
 * ⚠️ 盘符必须**大写**：`path.resolve()` 给的是小写 `c:`，而浏览器会把 URL 里的盘符
 * 规范成大写（`location.href` 是 `file:///C:/…`），`directoryOf` 读的正是它。
 * 这一处不对齐会让探针假红一次 —— 看着像产品回归，其实是期望值写错了。
 *
 * ⚠️ P0-9 起 title 里报的是**原目录**（副本就落在原文件旁边）；P0-8 那时报的是 `_改/` 的路径。
 */
const MULTI_DIR =
  resolve('qa/fixtures/multi-file')
    .replace(/\//g, '\\')
    .replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`) + '\\';

const results = [];
async function check(name, fn) {
  try {
    results.push({ name, ok: true, detail: String(await fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 220) });
  }
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
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

// 全局收集未捕获异常与 console.error —— **必须在第一个 goto 之前挂上**：
// 等到最后才挂只能看见那一瞬间的错误，前面十几步里真实崩过的错一个都收不到。
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
});

/** 保存按钮（工具条在 open 模式的 Shadow DOM 里，Playwright 的 CSS 引擎会穿透）。 */
const saveBtn = () => page.getByRole('button', { name: '另存为副本', exact: true });

async function open(p) {
  await page.goto(toUrl(p));
  // 🔴 「装没装上」不能靠「浏览器起来了」推断，必须去页面里找 #ep-root。
  await page.waitForSelector('#ep-root', { timeout: 10_000 });
  await page.waitForTimeout(80);
}

await open(MULTI);

await check('扩展已注入这份本地页面（去页面里找 #ep-root，而不是靠浏览器起来了）', async () => {
  const n = await page.locator('#ep-root').count();
  if (n !== 1) throw new Error(`#ep-root 计数 = ${n}`);
  return '#ep-root × 1';
});

await check('🔴 夹具前提成立：同目录的 app.js 真的被加载了（否则「多文件」只是名义上的）', async () => {
  // 若 app.js 没跟到同目录，这段文本会停留在「脚本还没跑起来。」——
  // 那么后面所有「依赖侦测正确」的结论都建立在错误的前提上。
  const text = await page.locator('#tick').textContent();
  if (!text.includes('脚本已跑起来')) throw new Error(`#tick 仍是「${text}」`);
  return 'app.js 已执行（#tick 被改写）';
});

await check('保存按钮可用（依赖提示不该把功能弄坏）', async () => {
  const disabled = await saveBtn().isDisabled();
  const busy = await saveBtn().getAttribute('aria-busy');
  if (disabled) throw new Error(`按钮被禁用（aria-busy=${busy}）`);
  return `disabled=false, aria-busy=${busy}`;
});

await check('🔴 提示里报出**两个同目录依赖**（P0-7 的核心产出）', async () => {
  const title = await saveBtn().getAttribute('title');
  for (const dep of ['styles.css', 'app.js']) {
    if (!title.includes(dep)) throw new Error(`title 里没有 ${dep}：${title}`);
  }
  return title;
});

await check('提示里报出**原目录**的落点路径（FSA 拿不到路径，这是唯一来源）', async () => {
  const title = await saveBtn().getAttribute('title');
  if (!title.includes(MULTI_DIR)) throw new Error(`title 里没有 ${MULTI_DIR}：${title}`);
  return MULTI_DIR;
});

await check('🔴 提示里明说「原文件不会被改动」—— 这是形态转向的全部意义', async () => {
  const title = await saveBtn().getAttribute('title');
  if (!title.includes('原文件不会被改动')) throw new Error(`title 里没有这句保证：${title}`);
  return '已保证';
});

await check('🔴 提示里明说依赖会**内联进副本** —— 反过来会让用户以为副本离不开原目录', async () => {
  const title = await saveBtn().getAttribute('title');
  if (!title.includes('内联进副本') || !title.includes('拉出去分享')) {
    throw new Error(`title 里没说清依赖会被内联、副本可单独分享：${title}`);
  }
  return '已说清';
});

await check('提示里**不含**编辑器自己的东西（宿主/注入物不许被算成页面依赖）', async () => {
  const title = await saveBtn().getAttribute('title');
  for (const bad of ['content.js', 'ep-', 'ep-root']) {
    if (title.includes(bad)) throw new Error(`title 里出现了 ${bad}：${title}`);
  }
  return '无 content.js / 无 ep-';
});

await check('这份页面确实含脚本（保存提示里那句「含脚本」的补充说明才有依据）', async () => {
  const n = await page.locator('script').count();
  if (n < 1) throw new Error('页面里一个 script 都没有');
  return `script × ${n}`;
});

// ── 反向确认：不是「无论什么页面都报依赖」─────────────────────────────
await open(SINGLE);

await check('🔴 单文件页面**不提依赖**（反向确认：提示不是恒真的，恒真就等于没有）', async () => {
  const title = await saveBtn().getAttribute('title');
  // 断言「不提依赖」而不是比对整句：整句里含机器相关的绝对路径，写死会让探针换机即红。
  // 🔴 P0-9 的两支文案是**互斥**的（`页面没有同目录依赖` ↔ `内联进副本`），所以这里能
  // 干净地判别；若哪天两支都提到「内联」，这条反向确认就会失去判别力 —— 那时必须改文案
  // 而不是改断言（见 ui/toast.ts 里 `saveTitle` 的说明）。
  if (title.includes('内联进副本') || /styles\.css|app\.js/.test(title)) {
    throw new Error(`单文件页面却提了依赖：${title}`);
  }
  if (!title.includes('没有同目录依赖')) throw new Error(`title 里没有「没有同目录依赖」：${title}`);
  if (!title.includes('原文件不会被改动')) throw new Error(`title 里没有落点保证：${title}`);
  return title;
});

await check('全程无未捕获异常 / 无 console.error', async () => {
  if (pageErrors.length) throw new Error(pageErrors.slice(0, 3).join(' | '));
  return '0 条';
});

await ctx.close();

console.log('\n══════════ P0-7 多文件页面防护验收（提示面）══════════');
console.log(`载体浏览器：${BROWSER ?? 'Playwright 自带 Chromium（默认）'}`);
console.log(`多文件夹具：${toUrl(MULTI)}`);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
console.log('⚠️ 「真正落盘」面（写进原目录、记住目录 ⇒ 下次不弹框）与「内联有没有真的生效」需人手门禁 G1 复验，本探针不覆盖。');
if (failed.length) process.exitCode = 1;
