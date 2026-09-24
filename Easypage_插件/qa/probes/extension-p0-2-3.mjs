// P0-2 + P0-3 验收探针：覆盖层标注与事件仲裁。
//
// 为什么必须走真实浏览器：本批次的每一条结论都依赖「真事件 + 真布局」——
//   · 打没打到页面自己的 handler，只有真派发才知道；
//   · 归一用的是 `getComputedStyle` 的 display，只有真 CSS 引擎才给得对；
//   · 滚动跟随依赖真实的滚动容器与 rAF 时序。
// happy-dom 里这些全是「看起来对」的假断言（同一套归一规则的纯逻辑已由
// tests/unit/extension-pick.test.ts 覆盖，两边不重复）。
//
// 前置（同 P0-1）：必须 headed + launchPersistentContext + --load-extension。
// 用法：node qa/probes/extension-p0-2-3.mjs   （需先 npm run build:extension）
// 可用 EP_PROBE_BROWSER 指定载体（见 qa/probes/browser-channel-extension-capability.mjs）。

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSER = process.env.EP_PROBE_BROWSER || undefined;
const EXT_DIR = resolve('dist-extension');
const FIXTURE = resolve('qa/fixtures/pick-page.html');
// profile 刻意**不删**：删一个 profile 是几百个文件的批量删除，会撞上沙箱的
// 批量删除护栏；而复用 profile 不影响结果 —— 每次都是新页面、content script 重新注入，
// 编辑模式状态天然从 browse 开始。
const PROFILE_DIR = resolve('test-results/p0-2-3-profile');

if (!existsSync(FIXTURE)) {
  console.error(`[x] 缺少夹具: ${FIXTURE}`);
  process.exit(1);
}
mkdirSync(resolve('test-results'), { recursive: true });

const results = [];
async function check(name, fn) {
  try {
    results.push({ name, ok: true, detail: String(await fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 200) });
  }
}

/** 元素中心点（视口坐标）。 */
async function centerOf(selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} 没有盒子（不可见？）`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** 覆盖层某个框的矩形；不可见时返回 null。 */
async function boxOf(id) {
  return page.locator(`#${id}`).boundingBox();
}

function near(a, b, tol = 2) {
  return Math.abs(a - b) <= tol;
}

function fmt(box) {
  if (!box) return 'null';
  return `(${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.width)}×${Math.round(box.height)}`;
}

/** 断言两个矩形贴合。 */
function assertAligned(actual, expected, label) {
  if (!actual) throw new Error(`${label}：覆盖层框不可见`);
  const bad = [];
  if (!near(actual.x, expected.x)) bad.push(`left ${Math.round(actual.x)}≠${Math.round(expected.x)}`);
  if (!near(actual.y, expected.y)) bad.push(`top ${Math.round(actual.y)}≠${Math.round(expected.y)}`);
  if (!near(actual.width, expected.width)) bad.push(`w ${Math.round(actual.width)}≠${Math.round(expected.width)}`);
  if (!near(actual.height, expected.height))
    bad.push(`h ${Math.round(actual.height)}≠${Math.round(expected.height)}`);
  if (bad.length) throw new Error(`${label}：${bad.join(' / ')}`);
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false, // 必须（门禁 G2）
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
await page.waitForSelector('#ep-root', { timeout: 10_000 }).catch(() => {});

const editBtn = page.getByRole('button', { name: '编辑模式', exact: true });
const mode = () => page.locator('#ep-root').getAttribute('data-ep-mode');
const resetProbe = () => page.evaluate(() => document.body.removeAttribute('data-probe-clicked'));
const probeClicked = () => page.evaluate(() => document.body.getAttribute('data-probe-clicked'));

// ════════════ 一、浏览模式：页面行为必须与未装插件时一致 ════════════

await check('🔴 浏览模式 · 点页面自己的按钮 ⇒ handler 触发', async () => {
  await resetProbe();
  const c = await centerOf('#btn');
  await page.mouse.click(c.x, c.y);
  const v = await probeClicked();
  if (v !== 'yes') throw new Error('页面 handler 未触发 ⇒ 宿主吞掉了点击');
  return 'data-probe-clicked=yes';
});

await check('浏览模式 · 点锚链接 ⇒ 照常跳转（hash 变化）', async () => {
  const before = await page.evaluate(() => location.hash);
  const c = await centerOf('#link');
  await page.mouse.click(c.x, c.y);
  const after = await page.evaluate(() => location.hash);
  if (after === before) throw new Error(`hash 未变（${before} → ${after}）`);
  // 跳转把页面滚到了 #jump，复位回顶部，后续统一按顶部坐标取点
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);
  return `${before || '(空)'} → ${after}`;
});

await check('浏览模式 · 覆盖层不出框（一个都不显示）', async () => {
  const h = await boxOf('ep-hover-box');
  const s = await boxOf('ep-selected-box');
  if (h || s) throw new Error(`hover=${fmt(h)} selected=${fmt(s)}`);
  return '两者皆不可见';
});

// ════════════ 二、编辑模式：接管 ════════════

await check('进入编辑模式', async () => {
  await editBtn.click();
  const m = await mode();
  if (m !== 'edit') throw new Error(`mode=${m}`);
  return 'data-ep-mode=edit';
});

await check('🔴 编辑模式 · 点页面按钮 ⇒ 页面 handler 被接管（不触发）', async () => {
  await resetProbe();
  const c = await centerOf('#btn');
  await page.mouse.click(c.x, c.y);
  const v = await probeClicked();
  if (v === 'yes') throw new Error('页面 handler 仍被触发 ⇒ 仲裁失效');
  return 'data-probe-clicked 未设置';
});

await check('编辑模式 · 点锚链接 ⇒ 不跳转（hash 不变）', async () => {
  const before = await page.evaluate(() => location.hash);
  const c = await centerOf('#link');
  await page.mouse.click(c.x, c.y);
  const after = await page.evaluate(() => location.hash);
  if (after !== before) throw new Error(`hash 被改了（${before} → ${after}）`);
  return `hash 保持 ${after}`;
});

// ════════════ 三、归一：点哪里 ⇒ 选中什么 ════════════

await check('🔴 点段落里的 <strong> ⇒ 选中框贴合整个 <p>（归一）', async () => {
  const c = await centerOf('#bold');
  await page.mouse.click(c.x, c.y);
  const selected = await boxOf('ep-selected-box');
  const para = await page.locator('#para').boundingBox();
  assertAligned(selected, para, '归一失败');
  return `选中框 ${fmt(selected)} ≈ p ${fmt(para)}`;
});

await check('嵌套：点内层 ⇒ 选中内层而非外层', async () => {
  const c = await centerOf('#inner');
  await page.mouse.click(c.x, c.y);
  const selected = await boxOf('ep-selected-box');
  const inner = await page.locator('#inner').boundingBox();
  const outer = await page.locator('#outer').boundingBox();
  assertAligned(selected, inner, '未停在内层');
  if (near(selected.height, outer.height)) throw new Error('框高度等于外层 ⇒ 归一到外层去了');
  return `选中框 ${fmt(selected)} ≈ inner ${fmt(inner)}`;
});

await check('表格：点单元格 ⇒ 停在该 <td>，不吞整表', async () => {
  const c = await centerOf('#cell');
  await page.mouse.click(c.x, c.y);
  const selected = await boxOf('ep-selected-box');
  const cell = await page.locator('#cell').boundingBox();
  assertAligned(selected, cell, '未停在 td');
  return `选中框 ${fmt(selected)} ≈ td ${fmt(cell)}`;
});

await check('Esc ⇒ 取消选中（框消失）', async () => {
  await page.keyboard.press('Escape');
  const selected = await boxOf('ep-selected-box');
  if (selected) throw new Error(`框仍在 ${fmt(selected)}`);
  return '已取消';
});

// ════════════ 四、hover ════════════

await check('🔴 hover 与点击选中同一个元素（归一函数共用）', async () => {
  const c = await centerOf('#bold');
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(120);
  const hover = await boxOf('ep-hover-box');
  const para = await page.locator('#para').boundingBox();
  assertAligned(hover, para, 'hover 与选中不一致');
  return `hover 框 ${fmt(hover)} ≈ p ${fmt(para)}`;
});

await check('🔴 大容器 hover ⇒ 只描边不填充（data-fill=false，T123）', async () => {
  // 大容器在页面下方，必须先滚到可见：视口外的坐标派发不到元素上，会得到
  // 「框隐藏 + data-fill 残留上一次的值」的假象 —— 所以这里先断言框可见，
  // 不让「什么都没发生」冒充「结果正确」。
  await page.locator('#bigbox').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const c = await centerOf('#bigbox');
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(150);
  const hover = await boxOf('ep-hover-box');
  if (!hover) throw new Error('hover 框不可见 ⇒ 没打到大容器上（坐标在视口外？）');
  const fill = await page.locator('#ep-hover-box').getAttribute('data-fill');
  if (fill !== 'false') throw new Error(`data-fill=${fill} ⇒ 大面积填充会盖住整页内容`);
  return `data-fill=false，框 ${fmt(hover)}`;
});
// 上面为了够到大容器滚动过，复位回顶部，否则后续「滚动跟随」的取点全部错位。
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(150);

await check('指针移到工具条上 ⇒ hover 框清空（不滞留）', async () => {
  const c = await centerOf('#ep-ext-bar');
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(120);
  const hover = await boxOf('ep-hover-box');
  if (hover) throw new Error(`框滞留 ${fmt(hover)}`);
  return '已清空';
});

// ════════════ 五、滚动跟随（P0-2 的核心） ════════════

await check('🔴 滚动后选中框跟随（位移 = 滚动量）', async () => {
  const c = await centerOf('#para');
  await page.mouse.click(c.x, c.y);
  const before = await boxOf('ep-selected-box');
  if (!before) throw new Error('未选中');

  const DELTA = 200;
  await page.evaluate((d) => window.scrollBy(0, d), DELTA);
  await page.waitForTimeout(150);

  const after = await boxOf('ep-selected-box');
  if (!after) throw new Error('滚动后框消失了（应仍可见）');
  const moved = before.y - after.y;
  if (!near(moved, DELTA, 3)) throw new Error(`框位移 ${Math.round(moved)} ≠ 滚动量 ${DELTA}`);
  return `框上移 ${Math.round(moved)}px（滚动 ${DELTA}px）`;
});

await check('滚动到元素出视口 ⇒ 框隐藏（不留悬空框）', async () => {
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(150);
  const selected = await boxOf('ep-selected-box');
  if (selected) throw new Error(`元素已出视口，框仍在 ${fmt(selected)}`);
  return '已隐藏';
});

await check('滚回顶部 ⇒ 框重新出现且重新贴合', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const selected = await boxOf('ep-selected-box');
  const para = await page.locator('#para').boundingBox();
  assertAligned(selected, para, '复位后未重新贴合');
  return `框 ${fmt(selected)} ≈ p ${fmt(para)}`;
});

// ════════════ 六、退出编辑模式：一切归零 ════════════

await check('退出编辑模式 ⇒ 覆盖层清空 + 页面行为恢复', async () => {
  await editBtn.click();
  const m = await mode();
  if (m !== 'browse') throw new Error(`mode=${m}`);
  const h = await boxOf('ep-hover-box');
  const s = await boxOf('ep-selected-box');
  if (h || s) throw new Error(`仍有框 hover=${fmt(h)} selected=${fmt(s)}`);

  await resetProbe();
  const c = await centerOf('#btn');
  await page.mouse.click(c.x, c.y);
  const v = await probeClicked();
  if (v !== 'yes') throw new Error('退出后页面点击仍被吞 ⇒ 监听器没卸干净');
  return '覆盖层已清空，页面点击恢复';
});

// ════════════ 七、污染与报错 ════════════

await check('🔴 页面 light DOM 未被污染（除 #ep-root 外零 ep- 节点）', async () => {
  const leaked = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.id === 'ep-root') return;
      if (el.closest('#ep-root')) return;
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
  const text = await page.locator('#title').textContent();
  if (text !== '选中与滚动 · 探针夹具') throw new Error(`标题变了：${text}`);
  return '标题原样';
});

await check('零控制台报错 / 零未捕获异常', async () => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForTimeout(200);
  if (errors.length) throw new Error(errors.join(' | '));
  return 'errors=0';
});

// 实机截图取证（交付物要能看）
const SHOT_DIR = resolve('qa/report/p0-2-3');
mkdirSync(SHOT_DIR, { recursive: true });
await editBtn.click();
const shot = await centerOf('#bold');
await page.mouse.move(shot.x, shot.y);
await page.waitForTimeout(120);
await page.mouse.click(shot.x, shot.y);
await page.waitForTimeout(120);
await page.screenshot({ path: resolve(SHOT_DIR, '01-编辑态-选中段落.png') });
await page.locator('#bigbox').scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
const big = await centerOf('#bigbox');
await page.mouse.move(big.x, big.y);
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(SHOT_DIR, '02-大容器-只描边.png') });

await ctx.close();

console.log('\n══════════ P0-2 + P0-3 覆盖层与事件仲裁验收 ══════════');
console.log(`载体浏览器：${BROWSER ?? 'Playwright 自带 Chromium（默认）'}`);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) process.exitCode = 1;
