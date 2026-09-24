// P0-4 验收探针：Word 语义编辑（改字 / 加粗 / 倾斜 / 下划线 / 文字颜色 / 撤销重做）。
//
// 为什么必须走真实浏览器：
//   · 双击进入改字依赖真实的指针事件序列（Playwright 的 dblclick 会给两次 down）；
//   · 「选区级加粗」依赖真实的 Range / Selection —— happy-dom 里选不出东西，
//     只能测到「回落段级」那条分支（纯逻辑已由 tests/unit/extension-format.test.ts 覆盖）；
//   · 「改字不丢行内标签」依赖真实的 contenteditable 行为，这是本批次最要紧的一条。
//
// 前置（同 P0-1）：必须 headed + launchPersistentContext + --load-extension。
// 用法：node qa/probes/extension-p0-4.mjs   （需先 npm run build:extension）

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSER = process.env.EP_PROBE_BROWSER || undefined;
const EXT_DIR = resolve('dist-extension');
const FIXTURE = resolve('qa/fixtures/pick-page.html');
const PROFILE_DIR = resolve('test-results/p0-4-profile');

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
const FIXTURE_URL = `file:///${FIXTURE.replace(/\\/g, '/')}`;

// 全局收集未捕获异常与 console.error。
// ⚠️ 必须在第一个 goto 之前挂上：等到最后一项检查才 `page.on('pageerror')`，
// 只能看到那 200ms 内发生的错误，前面十几步里真实崩过的错一个都收不到（弱断言）。
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
});

/** 每次测试都从干净页面重来：编辑会改文档内容，串起来跑会互相污染。 */
async function openEditing() {
  await page.goto(FIXTURE_URL);
  await page.waitForSelector('#ep-root', { timeout: 10_000 }).catch(() => {});
  await page.getByRole('button', { name: '编辑模式', exact: true }).click();
  await page.waitForTimeout(60);
}

/**
 * ⚠️ `mouse.click/dblclick` 收的是**视口坐标**。元素若落在视口之外，点击会打在窗口外 ——
 * 页面什么都不发生，但断言失败看起来跟「功能坏了」一模一样。
 *
 * 2026-09-23 实测踩到：夹具里 `#bigbox` 高 528px、顶部在 y≈819，而视口只有 800 高，
 * 它的几何中心在 y=1083 —— 双击打在窗口外。当时我把这条失败归因成「白名单不含 SECTION」，
 * 是错的（把它加进白名单也不会变绿）。**这就是伪装成产品回归的假证据。**
 *
 * 所以统一先滚进视口，再显式拦住「点落在视口外」，让它报「前提不成立」而不是静默失败。
 */
async function centerOf(selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} 不可见`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const vp = page.viewportSize();
  if (x < 0 || y < 0 || x > vp.width - 1 || y > vp.height - 1) {
    throw new Error(`前提不成立：${selector} 的中心点 (${x},${y}) 落在视口 ${vp.width}x${vp.height} 之外`);
  }
  return { x, y };
}

async function clickEl(selector) {
  const { x, y } = await centerOf(selector);
  await page.mouse.click(x, y);
  await page.waitForTimeout(60);
}

async function dblclickEl(selector) {
  const { x, y } = await centerOf(selector);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(80);
}

/**
 * 双击「这个元素**自己的**区域」，而不是它的几何中心。
 *
 * 为什么需要它：含子元素的容器，其几何中心往往落在**子元素**身上。
 * 实测：`#outer` 是 720×102 的盒子（上 padding 24），中心点 y=535 那一点命中栈顶是
 * 它的子块 `div#inner` —— 于是「双击容器」这条断言实际测的是「双击子块」，
 * 是一份假装测到了的假证据。
 *
 * 做法：在目标盒内按网格采样，取第一个「命中栈顶（剔除编辑器宿主）就是它自己」的点。
 * 找不到就直接报错 —— 宁可红，也不要静默地测了别的东西。
 */
async function dblclickOwn(selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForTimeout(40);
  const pt = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const host = document.getElementById('ep-root'); // 宿主 position:fixed;inset:0，别被它盖住
    const pad = 3;
    for (let iy = 0; iy <= 8; iy++) {
      for (let ix = 0; ix <= 8; ix++) {
        const x = r.left + pad + ((r.width - pad * 2) * ix) / 8;
        const y = r.top + pad + ((r.height - pad * 2) * iy) / 8;
        if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) continue;
        const stack = document.elementsFromPoint(x, y).filter((n) => n !== host);
        if (stack[0] === el) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  }, selector);
  if (!pt) throw new Error(`前提不成立：找不到只命中 ${selector} 自己的点（视口内的采样点都被子元素占了？）`);
  await page.mouse.dblclick(pt.x, pt.y);
  await page.waitForTimeout(80);
  return pt;
}

const readStyle = (selector, prop) =>
  page.evaluate(
    ([s, p]) => {
      const el = document.querySelector(s);
      return el ? (el.style[p] ?? '') : null;
    },
    [selector, prop],
  );

const textOf = (selector) => page.locator(selector).textContent();
const countOf = (selector) => page.locator(selector).count();

const btn = (name) => page.getByRole('button', { name, exact: true });

// ════════════ 一、改字（双击进入 contenteditable） ════════════

await check('双击 ⇒ 进入就地改字（contenteditable + data-ep-editing）', async () => {
  await openEditing();
  await dblclickEl('#para');
  const info = await page.evaluate(() => {
    const p = document.getElementById('para');
    return { ce: p?.getAttribute('contenteditable'), mark: p?.getAttribute('data-ep-editing') };
  });
  if (info.ce !== 'true' || info.mark !== 'true') throw new Error(JSON.stringify(info));
  return `contenteditable=${info.ce} data-ep-editing=${info.mark}`;
});

await check('输入 + Enter 提交 ⇒ 文本变了，编辑标记已清除', async () => {
  await page.keyboard.type('XYZ');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  const info = await page.evaluate(() => {
    const p = document.getElementById('para');
    return {
      text: p?.textContent ?? '',
      ce: p?.hasAttribute('contenteditable'),
      mark: p?.hasAttribute('data-ep-editing'),
    };
  });
  if (!info.text.includes('XYZ')) throw new Error(`输入丢失：${info.text.slice(0, 40)}`);
  if (info.ce || info.mark) throw new Error(`标记残留 ce=${info.ce} mark=${info.mark}`);
  return '已提交且无残留标记';
});

await check('🔴 改字**不丢行内标签**（<strong> 仍在）', async () => {
  await openEditing();
  const before = await countOf('#bold');
  await dblclickEl('#para');
  await page.keyboard.type('Z');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  const after = await countOf('#bold');
  const text = await textOf('#para');
  if (after !== before) throw new Error(`<strong> 丢了：before=${before} after=${after}`);
  if (!text?.includes('Z')) throw new Error('新输入的文字没进去');
  return `<strong> 保留（${after} 个），文本已更新`;
});

await check('Esc ⇒ 放弃修改（内容回到编辑前）', async () => {
  await openEditing();
  const before = await textOf('#para');
  await dblclickEl('#para');
  await page.keyboard.type('DISCARD');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  const after = await textOf('#para');
  if (after !== before) throw new Error(`内容未还原：${after?.slice(0, 40)}`);
  const mark = await page.evaluate(() => document.getElementById('para')?.hasAttribute('data-ep-editing'));
  if (mark) throw new Error('data-ep-editing 残留');
  return '已还原且无残留';
});

// ════════════ 二、段级格式（无选区时作用于整个元素） ════════════

await check('加粗：点一下设 700，按钮 aria-pressed=true', async () => {
  await openEditing();
  await clickEl('#para');
  await btn('加粗').click();
  await page.waitForTimeout(60);
  const w = await readStyle('#para', 'fontWeight');
  const pressed = await btn('加粗').getAttribute('aria-pressed');
  if (w !== '700') throw new Error(`fontWeight=${w}`);
  if (pressed !== 'true') throw new Error(`aria-pressed=${pressed}`);
  return `fontWeight=700, pressed=true`;
});

await check('加粗：再点一下取消（内联值被清掉，不是写 400）', async () => {
  await btn('加粗').click();
  await page.waitForTimeout(60);
  const w = await readStyle('#para', 'fontWeight');
  const pressed = await btn('加粗').getAttribute('aria-pressed');
  if (w !== '') throw new Error(`fontWeight=${w}`);
  if (pressed !== 'false') throw new Error(`aria-pressed=${pressed}`);
  return '已取消';
});

await check('倾斜 / 下划线 各切一次', async () => {
  await btn('倾斜').click();
  await btn('下划线').click();
  await page.waitForTimeout(60);
  const fs = await readStyle('#para', 'fontStyle');
  const td = await readStyle('#para', 'textDecorationLine');
  if (fs !== 'italic') throw new Error(`fontStyle=${fs}`);
  if (!td.includes('underline')) throw new Error(`textDecorationLine=${td}`);
  return `fontStyle=italic, textDecorationLine=${td}`;
});

await check('未选中元素时格式按钮禁用', async () => {
  await page.keyboard.press('Escape'); // 取消选中
  await page.waitForTimeout(60);
  const disabled = await btn('加粗').isDisabled();
  if (!disabled) throw new Error('没选中元素时「加粗」仍可点');
  return 'disabled=true';
});

// ════════════ 三、文字颜色（色板浮层） ════════════

await check('色板可开合，取色后写入 style.color 并自动关闭', async () => {
  await openEditing();
  await clickEl('#para');
  await btn('文字颜色').click();
  const opened = await page.locator('.ep-ext-colors').getAttribute('data-open');
  if (opened !== 'true') throw new Error(`色板未打开：data-open=${opened}`);

  await page.locator('.ep-ext-color[data-color="#c0392b"]').click();
  await page.waitForTimeout(60);
  const color = await readStyle('#para', 'color');
  const closed = await page.locator('.ep-ext-colors').getAttribute('data-open');
  if (color !== 'rgb(192, 57, 43)') throw new Error(`color=${color}`);
  if (closed !== 'false') throw new Error('取色后色板没关');
  return `color=${color}，色板已关闭`;
});

// ════════════ 四、撤销 / 重做 ════════════

await check('🔴 Ctrl+Z 撤销加粗，Ctrl+Shift+Z 重做', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(60);
  const afterUndo = await readStyle('#para', 'color');
  if (afterUndo !== '') throw new Error(`撤销后 color=${afterUndo}`);

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(60);
  const afterRedo = await readStyle('#para', 'color');
  if (afterRedo !== 'rgb(192, 57, 43)') throw new Error(`重做后 color=${afterRedo}`);
  return '撤销 → 重做 往返正常';
});

await check('工具条撤销按钮：无历史时禁用，有历史时可用', async () => {
  await openEditing();
  const before = await btn('撤销').isDisabled();
  if (!before) throw new Error('刚打开时「撤销」应禁用（历史为空）');
  await clickEl('#para');
  await btn('倾斜').click();
  await page.waitForTimeout(60);
  const after = await btn('撤销').isDisabled();
  if (after) throw new Error('有历史后「撤销」仍禁用');
  return '空历史禁用 → 有历史可用';
});

// ════════════ 五、选区级格式（精确到词） ════════════

/**
 * 在 #para 里程序化设一个选区（模拟用户拖选）。
 *
 * 用「以某段文字开头」定位文本节点，而不是用「第几个子节点下标」：
 * 包裹一次之后，`wrapTextNode` 会把原文本节点切分重建，子节点下标随之漂移 ——
 * 原先按下标取节点的写法在「解包」那一项里会选到段尾的另一个文本节点，
 * 于是测出的是**假失败**（真的去包了个新词，数量当然不是 1）。
 */
async function selectRun(prefix, len) {
  await page.evaluate(
    ([pfx, n]) => {
      const p = document.getElementById('para');
      if (!p) throw new Error('#para 不存在');
      p.focus();
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = null;
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if ((t.textContent ?? '').trim().startsWith(pfx)) {
          node = t;
          break;
        }
      }
      if (!node) throw new Error(`找不到以「${pfx}」开头的文本节点`);
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, n);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    [prefix, len],
  );
}

await check('🔴 有选区时 Ctrl+B ⇒ 包成 <strong>（字符级，不是整段）', async () => {
  await openEditing();
  await dblclickEl('#para'); // 进入改字态，才有真实选区可言
  const fullText = await textOf('#para');
  await selectRun('这一段里', 4);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(80);

  const info = await page.evaluate(() => {
    const p = document.getElementById('para');
    const strongs = Array.from(p?.querySelectorAll('strong') ?? []);
    return {
      count: strongs.length,
      // 每个 <strong> 的文本，用于断言「新增的那个恰好是「这一段里」」
      texts: strongs.map((s) => s.textContent ?? ''),
      weight: p?.style.fontWeight ?? '',
      text: p?.textContent ?? '',
    };
  });
  if (info.count !== 2) throw new Error(`<strong> 数量=${info.count}（期望 2：原有 1 + 新增 1）`);
  // ⚠️ 不能拿「长度 === 4」当判据：夹具里原有的 `<strong>加粗的词</strong>` 同样正好 4 个字，
  // 两个都会命中 ⇒ 断言恒假。必须比对具体文本（这是探针曾经的 bug，不是产品的）。
  if (!info.texts.includes('这一段里')) throw new Error(`没找到包裹「这一段里」：${JSON.stringify(info.texts)}`);
  if (!info.texts.includes('加粗的词')) throw new Error(`原有的 <strong> 丢了：${JSON.stringify(info.texts)}`);
  // 关键反证：段级路径若被误走，这里会是 700
  if (info.weight !== '') throw new Error(`走了段级路径（fontWeight=${info.weight}）`);
  if (info.text !== fullText) throw new Error('文本内容被改动了');
  return `新增包裹「这一段里」，原有「加粗的词」在位，且未落到段级`;
});

await check('已包裹的选区再按 Ctrl+B ⇒ 解包（与 Word 一致）', async () => {
  await selectRun('这一段里', 4);
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(80);
  const count = await countOf('#para strong');
  if (count !== 1) throw new Error(`解包失败，<strong> 数量=${count}`);
  return '已解包，只剩原有 1 个 <strong>';
});

// ════════════ 六、就地改字时的指针放行（选区的唯一来源） ════════════

await check('🔴 改字态下、编辑元素内的 pointerdown 不被拦截（否则无法拖选文字）', async () => {
  await openEditing();
  await dblclickEl('#para');
  // 页面侧读 defaultPrevented —— 必须用**捕获**阶段：
  // 编辑器的监听挂在 document 捕获上，而它在拦截时会 `stopPropagation()`，
  // 于是 document 冒泡阶段的探针监听根本轮不到执行，读到的永远是 null（假失败）。
  // 同节点同阶段按注册顺序执行，我们注册得晚 ⇒ 一定排在编辑器之后，读到的就是终值。
  await page.evaluate(() => {
    window.__pdInside = null;
    document.addEventListener('pointerdown', (e) => { window.__pdInside = e.defaultPrevented; }, { capture: true });
  });
  await dblclickEl('#para'); // 在编辑元素内部再点一次
  const inside = await page.evaluate(() => window.__pdInside);
  if (inside !== false) throw new Error(`编辑元素内 defaultPrevented=${inside} ⇒ 拖选会被阻断`);
  return 'defaultPrevented=false（拖选可用）';
});

await check('改字态下、编辑元素之外的 pointerdown 仍被拦截（页面点击被接管）', async () => {
  await page.evaluate(() => {
    window.__pdOutside = null;
    document.addEventListener('pointerdown', (e) => { window.__pdOutside = e.defaultPrevented; }, { capture: true });
  });
  await clickEl('#btn'); // 编辑元素之外
  const outside = await page.evaluate(() => window.__pdOutside);
  if (outside !== true) throw new Error(`编辑元素外 defaultPrevented=${outside} ⇒ 页面点击没被接管`);
  return 'defaultPrevented=true（页面点击被接管）';
});

// ════════════ 六之二、改字态的可见反馈（P0-4 遗留缺口） ════════════
// 原缺口：改字态**没有任何可见提示**，截图里「选中某段」与「正在改这段的字」长得一样。
// 用户看不出自己进了编辑态，也就不知道 Enter 会提交、Esc 会撤销。

const editBox = () => page.locator('#ep-edit-box');

await check('🔴 双击进改字 ⇒ 出现虚线改字框，且与实线选中框**叠加**在场', async () => {
  await openEditing();
  await dblclickEl('#para');
  if (!(await editBox().isVisible())) throw new Error('改字框没出现');
  const border = await editBox().evaluate((el) => getComputedStyle(el).borderStyle);
  if (border !== 'dashed') throw new Error(`改字框线型=${border}（应为 dashed，才与实线选中框可区分）`);
  if (!(await page.locator('#ep-selected-box').isVisible())) throw new Error('选中框不该消失（两层应叠加）');
  // 几何必须贴合被编辑元素 —— 与选中框同一套量测，错位就说明没接上 editBox
  const [a, b] = await Promise.all([editBox().boundingBox(), page.locator('#para').boundingBox()]);
  if (!a || !b || Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) {
    throw new Error(`改字框尺寸 ${a?.width}×${a?.height} ≠ #para ${b?.width}×${b?.height}`);
  }
  return `虚线框 ${Math.round(a.width)}×${Math.round(a.height)}，与选中框叠加`;
});

await check('Enter 提交 ⇒ 改字框收起', async () => {
  await page.keyboard.type('Q');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  if (await editBox().isVisible()) throw new Error('提交后改字框仍在');
  return '已收起';
});

await check('Esc 放弃 ⇒ 改字框也收起', async () => {
  await dblclickEl('#para');
  if (!(await editBox().isVisible())) throw new Error('前提不成立：改字框未出现');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  if (await editBox().isVisible()) throw new Error('Esc 后改字框仍在');
  return '已收起';
});

// 注：原先这里有一条「双击容器类（div）⇒ 只选中」，用的是 `#inner`。
// 2026-09-23 起 `#inner`（只装文字的 div）**应当可改** —— 该断言已迁到下面的容器矩阵，
// 混合容器那一格改用 `#outer`。

// ── 容器矩阵（2026-09-23 用户实测反馈后补）──
// 用户原话：「它编辑不了容器内的东西」。
// 根因：`isTextEditable` 原先靠**标签白名单**判定可改，而夹具里 `#inner` 是 <div> ——
// 不在名单里。这是白名单路线的根本问题：现实中大量文字就装在裸 <div> / <section> /
// 自定义元素里，白名单天生覆盖不到。
// 改成**结构性判定**：不含「有自己盒子的元素子节点」＝只装文字/行内内容 ⇒ 可改；
// 而 `#outer` 含块级子元素（`#inner`），仍必须拒绝 —— 让混合容器整体可编辑会把块级结构搅乱。
//
// ⚠️ 取点纪律：这四条一律用 `dblclickOwn`，**不用** `dblclickEl`。
// 实测：`#outer` 是 720×102 的盒子、上 padding 只有 24px，它的几何中心 (633,535) 命中栈顶
// 是它的子块 `div#inner` —— 用中心点会让「双击容器」这条断言实际测的是「双击子块」，
// 拿到一份「假装测到了」的假证据。
//
// 🔴 另需如实记一笔：本矩阵首次跑基线时另一条失败来自 `#bigbox`（中心在视口外，
// 双击打在窗口外）。那条**从来不是白名单的问题**，是取点越界 —— 当时我把它一起归因成
// 白名单缺陷，是错的。护栏已加在 `centerOf`/`dblclickOwn` 里。
const canEdit = async (selector) => {
  await openEditing();
  await dblclickOwn(selector);
  return editBox().isVisible();
};

await check('🔴 双击 leaf 容器（<div> 只装文字）⇒ 可改字', async () => {
  if (!(await canEdit('#inner'))) throw new Error('div 叶子块改不了字');
  return '可改（结构判定：无块级子元素）';
});

await check('🔴 双击 leaf 容器（<section> 只装文字）⇒ 可改字', async () => {
  if (!(await canEdit('#bigbox'))) throw new Error('section 叶子块改不了字');
  return '可改';
});

await check('双击表格单元格 ⇒ 可改字', async () => {
  if (!(await canEdit('#cell'))) throw new Error('td 改不了字');
  return '可改';
});

await check('🔴 双击**含块级子元素**的容器 ⇒ 仍只选中、不进改字', async () => {
  await openEditing();
  await dblclickOwn('#outer'); // 含 #inner 这个块级子元素
  if (await editBox().isVisible()) throw new Error('混合容器进了改字态 ⇒ 块级结构有被搅乱的风险');
  if (!(await page.locator('#ep-selected-box').isVisible())) throw new Error('应当只选中，但选中框也没出现');
  return '只选中（符合设计）';
});

// ════════════ 七、退出编辑模式：必须完全清除 ════════════

await check('🔴 退出编辑模式 ⇒ contenteditable / data-ep-editing 全部清除', async () => {
  await openEditing();
  await dblclickEl('#para'); // 处于改字态时直接退出
  await page.waitForTimeout(60);
  await btn('编辑模式').click();
  await page.waitForTimeout(80);
  const left = await page.evaluate(() => ({
    ce: document.querySelectorAll('[contenteditable]').length,
    mark: document.querySelectorAll('[data-ep-editing]').length,
  }));
  if (left.ce || left.mark) throw new Error(`残留 ce=${left.ce} mark=${left.mark}`);
  return '两者皆为零';
});

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

await check('零控制台报错 / 零未捕获异常（全程累计）', async () => {
  await page.waitForTimeout(150);
  // 用开头挂的全局收集器，而不是在这里新挂一个 —— 后者只能看见这 150ms 内的错误，
  // 前面十几步里真崩过的异常一条都漏（那是弱断言，会把「崩了」判成通过）。
  if (pageErrors.length) throw new Error(`${pageErrors.length} 条：${pageErrors.slice(0, 3).join(' | ')}`);
  return 'errors=0（全程）';
});

// 实机截图取证。
// ⚠️ 整段包在 try 里：这些动作没走 check()，一旦抛错会直接终止进程，
// 连上面那张结果表都打不出来（P0-2-3 探针踩过这个坑）。
try {
  const SHOT_DIR = resolve('qa/report/p0-4');
  mkdirSync(SHOT_DIR, { recursive: true });
  await openEditing();
  await clickEl('#para');
  await btn('加粗').click();
  await btn('文字颜色').click();
  await page.waitForTimeout(120);
  await page.screenshot({ path: resolve(SHOT_DIR, '01-格式与色板.png') });
  await page.locator('.ep-ext-color[data-color="#c0392b"]').click();
  await page.waitForTimeout(80);
  await page.screenshot({ path: resolve(SHOT_DIR, '02-改色后.png') });
  await dblclickEl('#para');
  await page.waitForTimeout(100);
  await page.screenshot({ path: resolve(SHOT_DIR, '03-就地改字.png') });
  console.log('截图已写入 qa/report/p0-4/');
} catch (err) {
  console.error('[!] 截图阶段失败（不影响上面的断言结果）：', String(err).split('\n')[0]);
}

// ════════════ 九、写回原文件（P0-5）════════════
// ⚠️ 这一组放在**最后**：点下保存会弹出**原生保存框**，它是 OS 级窗口，Playwright 摸不到。
// 弹出后页面交互不再可靠，所以它必须是最后的动作（浏览器随后被关闭，框随之消失）。
//
// 能自动化的：能力探测、按钮状态、以及「改字未提交时先提交」这条时序。
// 不能自动化的：真的把文件写到盘上 —— 那是门禁 G1，由人手点一次确认。

const saveBtn = () => page.getByRole('button', { name: '另存为副本', exact: true });

await check('🔴 保存按钮可用 ⇒ content script 上下文里确实拿得到 FSA', async () => {
  await openEditing();
  if (await saveBtn().isDisabled()) {
    const reason = await saveBtn().getAttribute('title');
    throw new Error(`保存按钮被禁用，title=${reason}`);
  }
  const title = await saveBtn().getAttribute('title');
  // ⚠️ 断言的措辞改过两次，改文案时必须回这里搜，否则会误判成产品回归：
  //   P0-5「写回…」→ P0-8「另存到 _改/：写入 …」→ P0-9「另存为 …，原文件不会被改动」。
  // 这里刻意断言**两个语义标记**而不是整句：整句含机器相关的绝对路径，写死会换机即红。
  // 两个标记选的是「这次形态转向的全部意义」：名字里带着副本、且原文件不动。
  if (!title?.includes('另存为') || !title.includes('原文件不会被改动')) {
    throw new Error(`title 未走到「可用」分支：${title}`);
  }
  return `可用 · title="${title}"`;
});

await check('🔴 点保存前会先提交正在进行的就地改字（否则最后一次输入会被丢掉）', async () => {
  await openEditing();
  await dblclickEl('#para');
  await page.keyboard.type('SAVE');
  const editingBefore = await page.evaluate(() => document.querySelectorAll('[data-ep-editing]').length);
  if (editingBefore !== 1) throw new Error(`前提不成立：改字态未建立（${editingBefore}）`);

  // 用坐标点击而不是 locator.click()：原生框弹出期间 locator 的 actionability 等待会挂住。
  const box = await saveBtn().boundingBox();
  if (!box) throw new Error('保存按钮不可见');
  await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await page.waitForTimeout(250);

  const left = await page.evaluate(() => ({
    ce: document.querySelectorAll('[contenteditable]').length,
    mark: document.querySelectorAll('[data-ep-editing]').length,
  }));
  if (left.ce || left.mark) throw new Error(`点保存时未提交就地改字：ce=${left.ce} mark=${left.mark}`);
  return '已提交，标记清零';
});

await check('🔴 原生保存框真的弹出来了（在等人，而不是立刻被环境回绝）', async () => {
  // 读数方式：写入期间按钮 `aria-busy="true"`。若原生框在场，promise 一直挂着 ⇒ busy 一直为真；
  // 若环境把调用挡掉了（例如无头/被策略拦），`showSaveFilePicker` 会立刻抛
  // AbortError / SecurityError，busy 会立刻回到 false 并弹出提示 —— 两种情形必须能区分。
  const busy = await saveBtn().getAttribute('aria-busy');
  const toastText = await page.locator('.ep-toast').textContent();
  if (busy !== 'true') {
    throw new Error(`保存调用已返回（aria-busy=${busy}，提示="${toastText}"）⇒ 原生框没弹出来`);
  }
  return `aria-busy=true（原生框在等人，提示区仍为空）`;
});

await ctx.close();

console.log('\n══════════ P0-4 Word 语义编辑验收 ══════════');
console.log(`载体浏览器：${BROWSER ?? 'Playwright 自带 Chromium（默认）'}`);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) process.exitCode = 1;
