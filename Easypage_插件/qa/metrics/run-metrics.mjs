#!/usr/bin/env node
/**
 * 易页 EasyPage · 样本库质量度量（T004 → 操作级升级）
 * ════════════════════════════════════════════════════════════════════
 *
 * 口径（契约 01 §8.2 / §8.3 原文，见 report.definitions 字段）：
 *
 *   §8.2 指标定义（原文）：
 *     对每个样本执行固定操作脚本：导入 → 改第一个 h1 文本 → 改某可定位元素背景色
 *     → 位移 (10,8) → 撤销 → 重做 → 切预览 → 导出。
 *       · 命中率 hitRate = 能成功完成上述全部操作且导出包含预期改动的样本数 / 总样本数。
 *       · 无损率 losslessRate：对"导入后不做任何编辑直接导出"的产物，用 parse5 规范化后
 *         与原始规范化结果对比，未改动节点/属性/文本的一致比例（忽略空白差异）。
 *       · 残留数 residueCount：导出 HTML 中匹配编辑器注入物（data-ep-、class="ep-、
 *         ep-overlay、contenteditable、编辑器注入的 <style id="ep-"/脚本）的命中数；
 *         必须为 0，否则导出阻断。
 *     命令：npm run qa:metrics 输出 qa/report/metrics-latest.json（含逐样本明细）。
 *     每张卡 PR 必须附该报告，且 hitRate/losslessRate 不得低于合入前基线、residueCount 必须为 0。
 *
 *   §8.2 落地现状（原文）：
 *     「hitRate 与 previewConsistency 需 T101 有真实编辑能力后，由 Playwright 跑"固定操作脚本"补全。
 *       residue 当前用六条正则检测，T101 接编辑器后升级为 §8.3 的 DOM 级纯函数清理。」
 *     —— 本脚本即兑现该升级：hitRate 由 Playwright 驱动真实 UI 取数；residue 改为在真实浏览器里
 *        parse 导出 HTML，按 data-ep-* 属性 / ep- 前缀类名 / #ep-overlay-root / contenteditable 判定。
 *
 *   §8.3 导出前清理清单（原文）：移除 ① contenteditable 与 data-ep-editing；② 任何 data-ep-*；
 *     ③ 覆盖层 #ep-overlay-root 及外壳节点；④ 编辑器注入的 <style id="ep-*"> / <script id="ep-*">；
 *     ⑤ 仅编辑期使用的临时 class。
 *
 * 本脚本操作脚本（固定、可复现，写死在本文件）：
 *   导入样本 → 双击文本目标改字 → 样式面板改背景色 → 合成指针拖拽位移 (10,8)
 *   → 样式面板写显式 px 宽高 → 拖 se 手柄缩放 (+40,+30) → Ctrl+Z 撤销 → Ctrl+Shift+Z 重做
 *   → 切预览 → 导出 HTML。
 *   选择器只依赖稳定 DOM 契约：按钮可见文案、#ep-canvas-frame、#ep-overlay-root [data-dir="se"]、
 *   #ep-preview-frame、.ep-box input[type=number]、[data-ep-editing]；不依赖任何内部实现细节。
 *
 * 依赖：仓库已装的 playwright(chromium) / vite / happy-dom，不新增任何 npm 包。
 *   static.* 为原有静态能力（happy-dom 规范化 token diff + 六条正则），**不参与门禁判定**。
 *
 * 用法：
 *   node qa/metrics/run-metrics.mjs                    # 跑度量并写 metrics-latest.json
 *   node qa/metrics/run-metrics.mjs --update-baseline  # 同时把本次结果写为 metrics-baseline.json
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const fixturesDir = join(repoRoot, 'qa', 'fixtures');
const reportDir = join(repoRoot, 'qa', 'report');
const reportFile = join(reportDir, 'metrics-latest.json');
const baselineFile = join(reportDir, 'metrics-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

/** 文件名（去 .html 后缀）→ 分类，与 qa/fixtures/README.md 索引一致。 */
const CATEGORY_BY_ID = {
  '01-script-carousel': '脚本轮播',
  '02-shadowdom': 'ShadowDOM',
  '03-svg-table': 'SVG 表格',
  '04-inline-image': '内联图片',
  '05-ai-landing': 'AI 生成页',
  '06-malformed': '残缺 HTML',
  '07-large': '大页精简版',
  '08-inline-events': '内联事件安全',
  '09-word-fragment': '文本片段',
  '10-flex-grid': 'Flex-Grid 布局',
};

/** 固定操作脚本的参数（写死，保证可复现）。 */
const OPS = {
  moveDx: 10,
  moveDy: 8,
  resizeDw: 40,
  resizeDh: 30,
  presetWidth: 120, // 样式面板写入的显式 px 宽（让元素具备可缩放前提）
  presetHeight: 80,
  bgColor: '#123456',
};

const PAGE_TIMEOUT_MS = 15_000;

/** 契约 §8.2/§8.3 原文，作为取值口径的唯一依据随报告落盘。 */
const CONTRACT_QUOTES = {
  source: 'docs/plan/01-技术基线与接口契约.md §8.2 / §8.3',
  fixedOpScript:
    '对每个样本执行固定操作脚本：导入 → 改第一个 h1 文本 → 改某可定位元素背景色 → 位移 (10,8) → 撤销 → 重做 → 切预览 → 导出。',
  hitRate: '命中率 hitRate = 能成功完成上述全部操作且导出包含预期改动的样本数 / 总样本数。',
  losslessRate:
    '无损率 losslessRate：对"导入后不做任何编辑直接导出"的产物，用 parse5 规范化后与原始规范化结果对比，未改动节点/属性/文本的一致比例（忽略空白差异）。',
  residueCount:
    '残留数 residueCount：导出 HTML 中匹配编辑器注入物（data-ep-、class="ep-、ep-overlay、contenteditable、编辑器注入的 <style id="ep-"/脚本）的命中数；必须为 0，否则导出阻断。',
  upgradeNote:
    'T003 落地现状：hitRate 与 previewConsistency 需 T101 有真实编辑能力后，由 Playwright 跑"固定操作脚本"补全。residue 当前用六条正则检测，T101 接编辑器后升级为 §8.3 的 DOM 级纯函数清理。',
  stripList:
    '§8.3 移除：① contenteditable 与 data-ep-editing；② 任何 data-ep-*；③ 覆盖层 #ep-overlay-root 及外壳节点；④ 编辑器注入的 <style id="ep-*"> / <script id="ep-*">；⑤ 仅编辑期使用的临时 class。',
};

// ── 静态口径（happy-dom 规范化 token diff；不参与门禁）────────

/** 把一段文本规范化：连续空白折叠为单个空格，再 trim。 */
function normText(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 把 Document 展平成可逐位比较的 token 数组（文档序前序遍历）。
 * 元素 token 按属性名字典序排序、属性值空白归一；纯空白文本节点丢弃。
 * includeDoctype=false 时不含 DOCTYPE token（用于「编辑态 DOM ↔ 导出产物」比对：
 * document.documentElement.outerHTML 天然不含 doctype，而导出产物带 `<!DOCTYPE html>` 前缀，
 * 若不对齐会让整个 token 流错位一位）。
 */
function tokenize(doc, includeDoctype = true) {
  const tokens = [];
  if (includeDoctype && doc.doctype) tokens.push(`DOCTYPE ${doc.doctype.name}`);
  const walk = (node) => {
    switch (node.nodeType) {
      case 1: {
        const attrs = [...node.attributes]
          .map((a) => [a.name, normText(a.value)])
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
        tokens.push(`ELEM <${node.tagName.toLowerCase()}> ${JSON.stringify(attrs)}`);
        for (const child of node.childNodes) walk(child);
        break;
      }
      case 3: {
        const t = normText(node.nodeValue || '');
        if (t) tokens.push(`TEXT ${JSON.stringify(t)}`);
        break;
      }
      case 8:
        tokens.push(`COMMENT ${JSON.stringify(normText(node.nodeValue || ''))}`);
        break;
      default:
        tokens.push(`OTHER<${node.nodeType}> ${node.nodeName}`);
    }
  };
  walk(doc.documentElement);
  return tokens;
}

/** 逐位比较两组 token，返回一致率、总单元数、命中数与首个差异位置。 */
function diffTokens(beforeTokens, afterTokens) {
  const total = Math.max(beforeTokens.length, afterTokens.length);
  let matched = 0;
  let firstDiff = null;
  for (let i = 0; i < total; i += 1) {
    const b = beforeTokens[i];
    const a = afterTokens[i];
    if (b === a) matched += 1;
    else if (!firstDiff) firstDiff = { index: i, before: b ?? null, after: a ?? null };
  }
  return { total, matched, rate: total === 0 ? 1 : matched / total, firstDiff };
}

/** 原六条正则口径（保留为静态能力，不参与门禁）。 */
const RESIDUE_PATTERNS = [
  { kind: 'data-ep-', re: /data-ep-/g },
  { kind: 'class="ep-', re: /class="ep-/g },
  { kind: 'ep-overlay-root', re: /ep-overlay-root/g },
  { kind: 'contenteditable', re: /contenteditable/g },
  { kind: '<style id="ep-', re: /<style\s+id="ep-/g },
  { kind: '<script id="ep-', re: /<script\s+id="ep-/g },
];

function countResidueRegex(html) {
  const hits = [];
  let total = 0;
  for (const { kind, re } of RESIDUE_PATTERNS) {
    const m = html.match(re);
    const count = m ? m.length : 0;
    total += count;
    if (count > 0) hits.push({ kind, count });
  }
  return { hits, total };
}

// ── 浏览器内使用的函数 ──────────────────────────────────────

/**
 * 在编辑 iframe 内挑选固定操作的目标元素，并给出唯一 CSS 路径。
 * 只依赖标签/能力/几何计算，不依赖编辑器内部对象。
 */
const PICK_TARGETS = () => {
  const NON_EDITABLE = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'br', 'hr']);
  const BLOCK_ONLY = new Set(['canvas', 'svg', 'iframe', 'video', 'audio']);
  const TEXT_PRIORITY = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BUTTON', 'SPAN', 'LI', 'A'];
  const cap = (el) => {
    const t = el.tagName.toLowerCase();
    if (NON_EDITABLE.has(t)) return 'non-editable';
    if (BLOCK_ONLY.has(t)) return 'block-only';
    return 'full';
  };
  const seg = (el) => {
    const parent = el.parentElement;
    const idx = Array.from(parent.children).indexOf(el) + 1;
    const tag = el.tagName.toLowerCase();
    return /^[a-z][a-z0-9-]*$/.test(tag) ? `${tag}:nth-child(${idx})` : `*:nth-child(${idx})`;
  };
  const path = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      if (!cur.parentElement) break;
      parts.unshift(seg(cur));
      cur = cur.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  };
  const all = Array.from(document.querySelectorAll('body *'));
  const rectOf = (el) => el.getBoundingClientRect();
  const visibleBox = (el) => {
    const r = rectOf(el);
    return r.width >= 8 && r.height >= 8;
  };
  const pack = (el) => {
    if (!el) return null;
    const r = rectOf(el);
    return {
      tag: el.tagName.toLowerCase(),
      path: path(el),
      cap: cap(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      text: (el.textContent || '').slice(0, 24),
    };
  };

  // 文本目标：按白名单优先级挑第一个可见、有文本的元素（<a> 置末位，避免 canvas 内点链接导致 iframe 导航）。
  let textEl = null;
  for (const tag of TEXT_PRIORITY) {
    textEl = all.find(
      (el) => el.tagName === tag && (el.textContent || '').trim().length > 0 && visibleBox(el),
    );
    if (textEl) break;
  }
  // 方块目标：full 能力 + 可见 + 非行内（行内元素改宽高不生效，无法验证缩放）
  const boxEl =
    all.find((el) => {
      if (cap(el) !== 'full') return false;
      if (!visibleBox(el)) return false;
      return getComputedStyle(el).display !== 'inline';
    }) || null;

  return { text: pack(textEl), box: pack(boxEl), count: all.length };
};

/**
 * 在真实浏览器里对导出 HTML 做 DOM 级残留检测（契约 §8.3）。
 * 判定：① 任何 data-ep-* 属性；② ep- / ep__ 前缀类名；③ #ep-overlay-root；④ contenteditable；
 *       ⑤ 编辑器注入的 <style id="ep-*"> / <script id="ep-*">。
 */
const DETECT_RESIDUE_DOM = (html) => {
  const EP_CLASS_RE = /^ep[-_]/;
  const hits = [];
  const push = (kind, detail) => hits.push({ kind, detail });
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch (e) {
    return { total: 1, hits: [{ kind: 'parse-error', detail: String(e) }], parseError: true };
  }
  for (const el of doc.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-ep-')) push('data-ep-*', `<${tag}>@${attr.name}`);
    }
    if (el.hasAttribute('contenteditable')) push('contenteditable', `<${tag}>@contenteditable`);
    const cls = el.getAttribute('class');
    if (cls) {
      const bad = cls.split(/\s+/).filter((c) => c && EP_CLASS_RE.test(c));
      if (bad.length) push('class-ep-*', `<${tag}>@class="${cls}"`);
    }
    if (el.id === 'ep-overlay-root') push('ep-overlay-root', `#${el.id}`);
    else if (el.id.startsWith('ep-') && (tag === 'style' || tag === 'script')) {
      push('injected-style-script', `<${tag} id="${el.id}">`);
    }
  }
  return { total: hits.length, hits };
};

// ── 页面操作助手 ────────────────────────────────────────────

/**
 * 判别力自检样本：五类编辑器注入物各一，用于证明 DOM 级残留检测确实会命中
 * （而非「永远返回 0」的空实现）。
 */
const RESIDUE_SELF_TEST_HTML =
  '<!DOCTYPE html><html><body>' +
  '<div data-ep-editing="true">a</div>' +
  '<div class="ep-selected-box-multi">b</div>' +
  '<div id="ep-overlay-root">c</div>' +
  '<p contenteditable="true">d</p>' +
  '<style id="ep-injected">.x{}</style>' +
  '</body></html>';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 布局前置条件的键名 / 取值，必须与 src/app/layout/UiLayout.ts 保持一致。
 * 本脚本是 .mjs，无法 import TS，故此处以字面量镜像 —— 改动源头时两处同步。
 */
const LAYOUT_KEY = 'easypage:layout';
const LAYOUT_OPEN_ALL = JSON.stringify({ left: true, right: true });

/**
 * 视图前置条件：键名 / 取值必须与 src/app/ui/ViewPrefs.ts 的 VIEW_E2E_PRESET 一致
 * （同为字面量镜像，改源头时两处同步）。
 *
 * 为什么度量也必须钉死这一项：批次 1（R2）起画布默认「自动适应宽度」，
 * 缩放比会随容器宽变化。而本度量的固定操作脚本里有一句
 * 「拖 se 手柄 (+40, +0)」——它是**屏幕像素**增量，元素宽高是**iframe 内部像素**，
 * 两者差一个缩放比。不钉死 zoom=1 就会变成「拖 40px 长 80px」，缩放断言必然失败，
 * hitRate 从 1 掉到 0，而这不是产品回归 —— 是度量口径少了一条前置。
 *   autoFit=false ⇒ 缩放恒 1；
 *   sections 全展开 ⇒ .ep-box / .ep-deco 字段常驻可见可交互。
 */
const VIEW_KEY = 'easypage:view';
const VIEW_PRESET = JSON.stringify({
  autoFit: false,
  sections: { text: true, box: true, deco: true },
});

/**
 * 新建一个「左右面板已展开」的上下文页面。
 *
 * 方案 C 默认收起左右面板；而本度量的固定操作脚本依赖样式面板的控件
 * （.ep-panel input[type=color] 与 .ep-box input[type=number]），
 * 故与 tests/e2e 同源处理：用 storageState 预置布局偏好作为统一前置条件，
 * 让度量口径与合入前基线保持可比（操作脚本本身一字未改）。
 */
async function newLayoutPage(browser, storageState) {
  const ctx = await browser.newContext({ storageState });
  const page = await ctx.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  return { ctx, page };
}

/** 打开应用并导入一段 HTML，返回 frameLocator。 */
async function importSource(page, baseUrl, source) {
  await page.addInitScript(() => {
    const w = window;
    w.__capturedBlob = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      w.__capturedBlob = blob;
      return orig(blob);
    };
  });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('textarea').fill(source);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  const edit = page.frameLocator('#ep-canvas-frame');
  await edit.locator('body').waitFor({ timeout: PAGE_TIMEOUT_MS });
  await page.locator('button:has-text("导出 HTML")').waitFor({ timeout: PAGE_TIMEOUT_MS });
  // 等导入后的选中态回调接线完成
  await page.locator('#ep-overlay-root').waitFor({ timeout: PAGE_TIMEOUT_MS });
  return edit;
}

/** 合成一次 pointerdown 让目标元素被选中（同时触发交互适配器 attach）。 */
async function selectElement(edit, path) {
  await edit.locator(path).evaluate((el) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  });
}

/**
 * 合成拖拽：第一次 pointerdown 只负责「选中 + attach 交互适配器」，
 * 第二次 pointerdown 才真正启动拖拽（与 tests/e2e/drag.spec.ts 同源的确定性写法）。
 */
async function dragElement(edit, path, dx, dy) {
  await edit.locator(path).evaluate(
    (el, d) => {
      const r = el.getBoundingClientRect();
      const x = r.left + 5; // ≤ EDGE_HANDLE_PX(10)，落在边缘带内必定可拖
      const y = r.top + 5;
      const mk = (type, cx, cy) =>
        new PointerEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy });
      const doc = el.ownerDocument;
      el.dispatchEvent(mk('pointerdown', x, y)); // 选中 + attach
      el.dispatchEvent(mk('pointerdown', x, y)); // 启动拖拽
      doc.dispatchEvent(mk('pointermove', x + d.dx, y + d.dy));
      doc.dispatchEvent(mk('pointerup', x + d.dx, y + d.dy));
    },
    { dx, dy },
  );
}

/** 拖 se 缩放手柄（与 tests/e2e/resize.spec.ts 同源写法）。 */
async function dragResizeHandle(page, dx, dy) {
  await page.locator('#ep-overlay-root [data-dir="se"]').evaluate(
    (h, d) => {
      const r = h.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      h.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
      window.dispatchEvent(
        new PointerEvent('pointermove', { clientX: cx + d.dx, clientY: cy + d.dy, bubbles: true }),
      );
      window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: cx + d.dx, clientY: cy + d.dy, bubbles: true }),
      );
    },
    { dx, dy },
  );
}

/**
 * 让 se 手柄变可见。
 * 编辑器顺序是 setSelected()（按当下 handlesVisible 决定 display）→ setHandlesVisible()（只翻标志位），
 * 因此「元素在选中时还不可缩放、之后才被写成显式 px」的场景需要再选一次才会重画手柄。
 * 这里重选至多 4 次，每次用真实合成 pointerdown 触发选中变化。
 */
async function ensureHandleVisible(page, edit, path) {
  const handle = page.locator('#ep-overlay-root [data-dir="se"]');
  for (let i = 0; i < 4; i += 1) {
    await selectElement(edit, path);
    if (await handle.isVisible()) return true;
    await sleep(60);
  }
  return handle.isVisible();
}

/** 读取编辑 iframe 内某路径元素的 inline 宽高与 transform。 */
async function readBox(edit, path) {
  return edit.locator(path).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      width: el.style.width,
      height: el.style.height,
      transform: el.style.transform,
      backgroundColor: el.style.backgroundColor,
      rectW: Math.round(r.width),
      rectH: Math.round(r.height),
    };
  });
}

/** 读取导出 blob 文本（由 addInitScript 捕获）。 */
async function readExported(page) {
  return page.evaluate(async () => {
    const b = window.__capturedBlob;
    return b ? await b.text() : null;
  });
}

/** 导出 HTML（点击「导出 HTML」并按 blob 捕获取回文本）。 */
async function exportHtml(page, edit) {
  // 读取导出前的编辑态 DOM，作为「导入→编辑→导出」真实前后比对的另一侧
  const editedDom = await edit.locator('body').evaluate(() => document.documentElement.outerHTML);
  await page.locator('button:has-text("导出 HTML")').click();
  let html = null;
  for (let i = 0; i < 40 && !html; i += 1) {
    html = await readExported(page);
    if (!html) await sleep(50);
  }
  return { html, editedDom };
}

// ── 固定操作脚本（真实 UI）───────────────────────────────────

async function runOpsFlow(page, baseUrl, source, id) {
  const marker = `EPMETRICS-改字-${id}`;
  const ops = {};
  const fail = [];
  const edit = await importSource(page, baseUrl, source);

  const targets = await edit.locator('body').evaluate(PICK_TARGETS);
  if (!targets.text) fail.push('未找到可双击改字的文本目标');
  if (!targets.box) fail.push('未找到可移动/缩放的方块目标');
  if (!targets.text || !targets.box) {
    return {
      ops,
      ok: false,
      fail,
      targets,
      exported: null,
      editedDom: null,
      marker,
      residue: { total: 0, hits: [] },
      expectedChanges: null,
      boxes: null,
    };
  }

  // ① 改文本：双击 → 输入标记 → Enter 提交
  try {
    await edit.locator(targets.text.path).dblclick({ timeout: PAGE_TIMEOUT_MS });
    const editing = edit.locator('[data-ep-editing]');
    await editing.waitFor({ timeout: 5000 });
    await editing.fill(marker);
    await page.keyboard.press('Enter');
    await edit.locator('[data-ep-editing]').waitFor({ state: 'detached', timeout: 5000 });
    const hasMark = await edit
      .locator('body')
      .evaluate((b, m) => (b.textContent || '').includes(m), marker);
    ops.editText = {
      ok: hasMark,
      detail: hasMark ? `文本已改为 ${marker}` : '提交后未在文档中找到标记文本',
    };
    if (!hasMark) fail.push('改文本未落盘');
  } catch (e) {
    ops.editText = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('改文本失败');
  }

  // ② 改背景色：选中方块目标 → 样式面板背景色控件提交 change
  try {
    await selectElement(edit, targets.box.path);
    const bg = page.locator('.ep-panel input[type=color]').nth(1);
    await bg.waitFor({ timeout: 5000 });
    await bg.evaluate((input, color) => {
      input.value = color;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, OPS.bgColor);
    const box = await readBox(edit, targets.box.path);
    const ok = box.backgroundColor.replace(/\s/g, '') === 'rgb(18,52,86)';
    ops.setBg = {
      ok,
      detail: ok ? `背景色=${OPS.bgColor}` : `背景色未生效（${box.backgroundColor || '空'}）`,
    };
    if (!ok) fail.push('改背景色未生效');
  } catch (e) {
    ops.setBg = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('改背景色失败');
  }

  // ③ 移动：合成拖拽 (10,8)
  let movedBox = null;
  try {
    const before = await readBox(edit, targets.box.path);
    await dragElement(edit, targets.box.path, OPS.moveDx, OPS.moveDy);
    const after = await readBox(edit, targets.box.path);
    movedBox = after;
    const ok = /translate\(/.test(after.transform) && after.transform !== before.transform;
    ops.move = {
      ok,
      detail: ok
        ? `transform: "${after.transform}"（期望含位移方向 ${OPS.moveDx},${OPS.moveDy}）`
        : `未产生 translate（"${after.transform}"）`,
    };
    if (!ok) fail.push('移动未产生位移');
  } catch (e) {
    ops.move = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('移动失败');
  }

  // ④ 缩放：样式面板写显式 px 宽高 → 重选触发手柄重算 → 拖 se 手柄 (+40,+30)
  let presetBox = null;
  let resizedBox = null;
  try {
    await selectElement(edit, targets.box.path);
    const wInput = page.locator('.ep-box input[type=number]').nth(0);
    const hInput = page.locator('.ep-box input[type=number]').nth(1);
    await wInput.waitFor({ timeout: PAGE_TIMEOUT_MS });
    await wInput.fill(String(OPS.presetWidth));
    await hInput.fill(String(OPS.presetHeight));
    await page.keyboard.press('Enter');
    presetBox = await readBox(edit, targets.box.path);
    if (!presetBox.width || !presetBox.height) {
      throw new Error(
        `样式面板未写入显式 px 宽高（${presetBox.width || '空'}/${presetBox.height || '空'}）`,
      );
    }
    const handleOk = await ensureHandleVisible(page, edit, targets.box.path);
    if (!handleOk) throw new Error('se 缩放手柄未出现（元素被判定为不可缩放）');
    await dragResizeHandle(page, OPS.resizeDw, OPS.resizeDh);
    resizedBox = await readBox(edit, targets.box.path);
    const ok =
      Number.parseFloat(resizedBox.width) > Number.parseFloat(presetBox.width) &&
      Number.parseFloat(resizedBox.height) > Number.parseFloat(presetBox.height);
    ops.resize = {
      ok,
      detail: ok
        ? `宽高 ${presetBox.width}/${presetBox.height} → ${resizedBox.width}/${resizedBox.height}`
        : `缩放未生效（${presetBox.width}/${presetBox.height} → ${resizedBox.width}/${resizedBox.height}）`,
    };
    if (!ok) fail.push('缩放未生效');
  } catch (e) {
    ops.resize = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('缩放失败');
  }

  // ⑤ 撤销：把焦点移出 iframe 后 Ctrl+Z（与 tests/e2e 同源做法）
  let undoBox = null;
  try {
    await page.locator('h1').first().click();
    await page.keyboard.press('Control+z');
    await sleep(80);
    undoBox = await readBox(edit, targets.box.path);
    const ok =
      presetBox !== null &&
      undoBox.width === presetBox.width &&
      undoBox.height === presetBox.height;
    ops.undo = {
      ok,
      detail: ok
        ? `宽高回到 ${undoBox.width}/${undoBox.height}`
        : `撤销后宽高 ${undoBox.width}/${undoBox.height}，期望 ${presetBox ? presetBox.width : '?'}/${presetBox ? presetBox.height : '?'}`,
    };
    if (!ok) fail.push('撤销未回到缩放前尺寸');
  } catch (e) {
    ops.undo = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('撤销失败');
  }

  // ⑥ 重做：Ctrl+Shift+Z
  let finalBox = null;
  try {
    await page.keyboard.press('Control+Shift+z');
    await sleep(80);
    finalBox = await readBox(edit, targets.box.path);
    const ok =
      presetBox !== null &&
      resizedBox !== null &&
      finalBox.width !== undoBox?.width &&
      Number.parseFloat(finalBox.width) > Number.parseFloat(presetBox.width) &&
      Number.parseFloat(finalBox.height) > Number.parseFloat(presetBox.height);
    ops.redo = {
      ok,
      detail: ok
        ? `宽高恢复为 ${finalBox.width}/${finalBox.height}`
        : `重做后宽高 ${finalBox.width}/${finalBox.height}，期望回到 ${resizedBox ? resizedBox.width : '?'}/${resizedBox ? resizedBox.height : '?'}`,
    };
    if (!ok) fail.push('重做未恢复缩放结果');
  } catch (e) {
    ops.redo = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('重做失败');
  }

  // ⑦ 切预览：开 → 预览态含标记文本 → 关
  try {
    await page.getByRole('button', { name: '预览' }).click();
    const preview = page.frameLocator('#ep-preview-frame');
    await page.locator('#ep-preview-frame').waitFor({ timeout: PAGE_TIMEOUT_MS });
    const inPreview = await preview
      .locator('body')
      .evaluate((b, m) => (b.textContent || '').includes(m), marker)
      .catch(() => false);
    await page.getByRole('button', { name: '预览' }).click();
    await page
      .locator('#ep-preview-frame')
      .waitFor({ state: 'detached', timeout: PAGE_TIMEOUT_MS });
    ops.preview = {
      ok: inPreview,
      detail: inPreview ? '预览态含编辑后的标记文本' : '预览态未含标记文本',
    };
    if (!inPreview) fail.push('预览与编辑态不一致');
  } catch (e) {
    ops.preview = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('切预览失败');
  }

  // ⑧ 导出：取回导出文件并核对预期改动
  let exported = null;
  let editedDom = null;
  let residue = { total: 0, hits: [] };
  let expectedChanges = null;
  try {
    const r = await exportHtml(page, edit);
    exported = r.html;
    editedDom = r.editedDom;
    if (!exported) {
      ops.export = { ok: false, detail: '未捕获到导出内容（导出被阻断或未触发）' };
      fail.push('导出未产出内容');
    } else {
      residue = await page.evaluate(DETECT_RESIDUE_DOM, exported);
      const checks = {
        hasMarker: exported.includes(marker),
        hasTransform: /translate\(/.test(exported),
        hasResized:
          !!finalBox &&
          exported.includes(`width: ${finalBox.width}`) &&
          exported.includes(`height: ${finalBox.height}`),
        hasBg: exported.includes('rgb(18, 52, 86)') || exported.includes('#123456'),
      };
      const ok = checks.hasMarker && checks.hasTransform && checks.hasResized;
      ops.export = {
        ok,
        detail: `标记=${checks.hasMarker} 位移=${checks.hasTransform} 缩放=${checks.hasResized} 背景色=${checks.hasBg} 长度=${exported.length}`,
      };
      expectedChanges = checks;
      if (!ok) fail.push('导出未包含全部预期改动');
    }
  } catch (e) {
    ops.export = { ok: false, detail: `异常：${String(e.message).split('\n')[0]}` };
    fail.push('导出失败');
  }

  const allOk =
    Object.values(ops).length === 8 && Object.values(ops).every((o) => o.ok) && residue.total === 0;
  if (residue.total > 0) fail.push(`导出残留 ${residue.total} 处`);

  return {
    ops,
    ok: allOk,
    fail,
    targets,
    exported,
    editedDom,
    marker,
    residue,
    expectedChanges,
    boxes: {
      moved: movedBox,
      preset: presetBox,
      resized: resizedBox,
      undo: undoBox,
      final: finalBox,
    },
  };
}

/** 「导入后不做任何编辑直接导出」——losslessRate 的取数流程。 */
async function runNoEditRoundTrip(page, baseUrl, source) {
  const edit = await importSource(page, baseUrl, source);
  const { html } = await exportHtml(page, edit);
  return { exported: html, edit };
}

// ── 主流程 ──────────────────────────────────────────────────

function listFixtures() {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.html'))
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  const startedAt = Date.now();
  if (!existsSync(fixturesDir)) throw new Error(`fixtures 目录不存在：${fixturesDir}`);

  const server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    server: { port: 4519, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  if (!baseUrl) throw new Error('vite dev server 未返回可用 URL');

  const browser = await chromium.launch({ headless: true });
  /** 面板展开的布局前置条件（见 newLayoutPage 注释）。origin 用 dev server 实际地址。 */
  const layoutStorageState = {
    cookies: [],
    origins: [
      {
        origin: new URL(baseUrl).origin,
        localStorage: [
          { name: LAYOUT_KEY, value: LAYOUT_OPEN_ALL },
          { name: VIEW_KEY, value: VIEW_PRESET },
        ],
      },
    ],
  };
  const files = listFixtures();
  const perFixture = [];
  const staticPerFixture = [];

  // —— 残留检测判别力自检：五类注入物必须都被命中 ——
  let residueSelfTest = { ok: false, expected: 5, actual: 0, kinds: [] };
  {
    const probePage = await browser.newPage();
    try {
      const r = await probePage.evaluate(DETECT_RESIDUE_DOM, RESIDUE_SELF_TEST_HTML);
      const kinds = [...new Set(r.hits.map((h) => h.kind))].sort();
      residueSelfTest = {
        ok: r.total === 5 && kinds.length === 5,
        expected: 5,
        actual: r.total,
        kinds,
      };
    } catch (e) {
      residueSelfTest.error = String(e.message);
    } finally {
      await probePage.close();
    }
  }

  const win = new Window();
  const parser = new win.DOMParser();

  let hitCount = 0;
  let residueTotal = 0;
  let losslessUnits = 0;
  let losslessMatched = 0;
  let roundTripUnits = 0;
  let roundTripMatched = 0;
  let staticUnits = 0;
  let staticMatched = 0;
  let staticResidue = 0;

  try {
    for (const file of files) {
      const id = file.replace(/\.html$/, '');
      const category = CATEGORY_BY_ID[id] || '未分类';
      const source = readFileSync(join(fixturesDir, file), 'utf8');

      // —— 无编辑往返：losslessRate 口径（契约 §8.2）——
      let losslessRate = null;
      let exportedNoEdit = null;
      let roundTrip = { losslessRate: null, matched: 0, total: 0 };
      const { ctx: ctxNoEdit, page: pageNoEdit } = await newLayoutPage(browser, layoutStorageState);
      try {
        const r = await runNoEditRoundTrip(pageNoEdit, baseUrl, source);
        exportedNoEdit = r.exported;
        if (exportedNoEdit) {
          const d = diffTokens(
            tokenize(parser.parseFromString(source, 'text/html')),
            tokenize(parser.parseFromString(exportedNoEdit, 'text/html')),
          );
          losslessRate = Number(d.rate.toFixed(4));
          losslessUnits += d.total;
          losslessMatched += d.matched;
          roundTrip = { losslessRate, matched: d.matched, total: d.total };
        }
      } catch (e) {
        roundTrip.error = String(e.message).split('\n')[0];
      } finally {
        await ctxNoEdit.close();
      }

      // —— 固定操作脚本：hitRate / residueCount / 编辑往返保真 ——
      const { ctx, page } = await newLayoutPage(browser, layoutStorageState);
      page.on('dialog', (d) => void d.dismiss().catch(() => {}));
      let opsResult;
      try {
        opsResult = await runOpsFlow(page, baseUrl, source, id);
      } catch (e) {
        opsResult = {
          ops: {},
          ok: false,
          fail: [`整体异常：${String(e.message).split('\n')[0]}`],
          targets: null,
          exported: null,
          editedDom: null,
          residue: { total: 0, hits: [] },
          expectedChanges: null,
          boxes: null,
        };
      } finally {
        await ctx.close();
      }

      if (opsResult.ok) hitCount += 1;
      residueTotal += opsResult.residue.total;

      // 编辑往返保真：导出前的编辑态 DOM ↔ 导出产物（导入→编辑→导出 的真实前后比对）
      let editedFidelity = null;
      let editedFidelityDetail = null;
      if (opsResult.exported && opsResult.editedDom) {
        // 两侧都不计 DOCTYPE：editedDom 取 documentElement.outerHTML 天然不含 doctype
        const d = diffTokens(
          tokenize(parser.parseFromString(opsResult.editedDom, 'text/html'), false),
          tokenize(parser.parseFromString(opsResult.exported, 'text/html'), false),
        );
        editedFidelity = Number(d.rate.toFixed(4));
        editedFidelityDetail = { matched: d.matched, total: d.total, firstDiff: d.firstDiff };
        roundTripUnits += d.total;
        roundTripMatched += d.matched;
      }

      // —— 原有静态能力（不参与门禁）——
      const srcTokens = tokenize(parser.parseFromString(source, 'text/html'));
      const outTokens = exportedNoEdit
        ? tokenize(parser.parseFromString(exportedNoEdit, 'text/html'))
        : [];
      const sDiff = diffTokens(srcTokens, outTokens);
      staticUnits += sDiff.total;
      staticMatched += sDiff.matched;
      const sResidue = exportedNoEdit ? countResidueRegex(exportedNoEdit) : { hits: [], total: 0 };
      staticResidue += sResidue.total;

      const notes = [];
      if (opsResult.targets) {
        const tgt = (t) => (t ? `<${t.tag}>` : '未找到');
        notes.push(
          `文本目标=${tgt(opsResult.targets.text)}；方块目标=${tgt(opsResult.targets.box)}`,
        );
      }
      if (opsResult.fail.length) notes.push(`失败项：${opsResult.fail.join('、')}`);

      const opPairs = Object.entries(opsResult.ops);
      perFixture.push({
        id,
        category,
        hit: opsResult.ok,
        allOpsOk: opPairs.length === 8 && opPairs.every(([, v]) => v.ok),
        opResults: opsResult.ops,
        failReasons: opsResult.fail,
        exportDiff: {
          hasExport: !!opsResult.exported,
          exportedLength: opsResult.exported ? opsResult.exported.length : 0,
          expectedChanges: opsResult.expectedChanges,
          summary: opPairs.map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'}`).join(' '),
        },
        residue: opsResult.residue,
        losslessRate,
        roundTrip,
        editedRoundTripFidelity: editedFidelity,
        editedRoundTripDetail: editedFidelityDetail,
        boxes: opsResult.boxes ?? null,
        notes: notes.join('；'),
      });

      staticPerFixture.push({
        id,
        losslessRate: Number(sDiff.rate.toFixed(4)),
        diffUnits: sDiff.total,
        residue: sResidue.hits,
        dataAvailable: !!exportedNoEdit,
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const n = files.length;
  const losslessRate =
    losslessUnits === 0 ? 0 : Number((losslessMatched / losslessUnits).toFixed(4));
  const editedRoundTripFidelity =
    roundTripUnits === 0 ? null : Number((roundTripMatched / roundTripUnits).toFixed(4));

  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    mode: 'playwright-ui-ops',
    definitions: {
      note: '本报告由 Playwright 驱动真实 UI 的固定操作脚本取数；static 字段为原有 happy-dom 静态能力，不参与门禁判定。',
      contractSource: CONTRACT_QUOTES.source,
      contractText: CONTRACT_QUOTES,
      fixedOperationScript: [
        '粘贴导入样本（textarea + 「导入 HTML」）',
        '双击文本目标改字并 Enter 提交（改文本）',
        '样式面板背景色控件提交 #123456（改背景色）',
        `合成指针拖拽位移 (${OPS.moveDx},${OPS.moveDy})（移动）`,
        `样式面板写显式 ${OPS.presetWidth}px/${OPS.presetHeight}px → 拖 se 手柄 (+${OPS.resizeDw},+${OPS.resizeDy})（缩放）`,
        '焦点移出画布后 Ctrl+Z（撤销）',
        'Ctrl+Shift+Z（重做）',
        '「预览」开 → 校验标记文本 → 再点「预览」关（切预览）',
        '「导出 HTML」并捕获导出文件（导出）',
      ],
      hitRate:
        '能成功完成上述全部固定操作、且导出包含预期改动（标记文本 / 位移 / 缩放尺寸）的样本数 ÷ 总样本数。契约原文见 contractText.hitRate。',
      losslessRate:
        '对"导入后不做任何编辑直接导出"的产物与原始样本做规范化 token 比对（忽略空白差异、属性顺序），取一致率；跨样本汇总为 Σmatched/Σtotal。契约原文见 contractText.losslessRate。',
      residueCount:
        '在真实浏览器中 DOMParser 解析导出 HTML，逐个元素判定：任何 data-ep-* 属性、ep-/ep__ 前缀类名、#ep-overlay-root、contenteditable、<style id="ep-*">/<script id="ep-*">。命中总数必须为 0。契约原文见 contractText.residueCount / contractText.stripList。',
      editedRoundTripFidelity:
        '补充口径（非契约原有项）：导出前的编辑态 DOM ↔ 导出产物 的 token 一致率，即「导入→编辑操作→导出」这条真实链路上导出回写的保真度。',
      staticMetrics:
        'static 字段为 T004 原有静态能力（happy-dom 规范化 token diff + 六条正则），仅供对照，不参与门禁判定。',
    },
    totals: {
      hitRate: n === 0 ? 0 : Number((hitCount / n).toFixed(4)),
      losslessRate,
      residueCount: residueTotal,
      editedRoundTripFidelity,
      samples: n,
      hitSamples: hitCount,
    },
    static: {
      participatesInGate: false,
      note: 'T004 原有静态能力（happy-dom 规范化 token diff + 六条正则），不参与门禁判定',
      totals: {
        losslessRate: staticUnits === 0 ? 0 : Number((staticMatched / staticUnits).toFixed(4)),
        residueCount: staticResidue,
        diffUnits: staticUnits,
      },
      perFixture: staticPerFixture,
    },
    residueDetectorSelfTest: residueSelfTest,
    perFixture,
  };

  // —— 门禁：与合入前基线比对 ——
  let baseline = null;
  if (!UPDATE_BASELINE && existsSync(baselineFile)) {
    try {
      baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    } catch {
      baseline = null;
    }
  }
  report.gate = evaluateGate(report, baseline, UPDATE_BASELINE);

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  if (UPDATE_BASELINE || !existsSync(baselineFile)) {
    writeFileSync(baselineFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
    report.gate.baselineWritten = baselineFile;
  }

  printHumanTable(report);
  if (report.gate.result === 'fail') process.exitCode = 1;
}

function evaluateGate(report, baseline, wroteBaseline) {
  const checks = [];
  const t = report.totals;
  checks.push({
    name: 'residueDetectorSelfTest（判别力自检：五类注入物全部命中）',
    ok: report.residueDetectorSelfTest.ok === true,
    actual: report.residueDetectorSelfTest.actual,
    expected: 5,
  });
  checks.push({
    name: 'residueCount === 0',
    ok: t.residueCount === 0,
    actual: t.residueCount,
    expected: 0,
  });
  if (!baseline || wroteBaseline || !baseline.totals) {
    return {
      result: 'no-baseline',
      note: wroteBaseline ? '已写入本次结果为合入前基线' : '未找到合入前基线，本次仅记录不判定',
      baselineFile: 'qa/report/metrics-baseline.json',
      checks,
    };
  }
  const b = baseline.totals;
  checks.push({
    name: 'hitRate >= baseline',
    ok: t.hitRate >= b.hitRate,
    actual: t.hitRate,
    expected: `>= ${b.hitRate}`,
  });
  checks.push({
    name: 'losslessRate >= baseline',
    ok: t.losslessRate >= b.losslessRate,
    actual: t.losslessRate,
    expected: `>= ${b.losslessRate}`,
  });
  const failed = checks.filter((c) => !c.ok);
  return {
    result: failed.length === 0 ? 'pass' : 'fail',
    baselineFile: 'qa/report/metrics-baseline.json',
    baselineGeneratedAt: baseline.generatedAt,
    checks,
    failed: failed.map((c) => c.name),
  };
}

function pad(s, n) {
  let width = 0;
  for (const ch of String(s)) width += ch.charCodeAt(0) > 255 ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(1, n - width));
}

function printHumanTable(report) {
  const line = '─'.repeat(96);
  console.log('');
  console.log('易页 EasyPage · 质量度量（Playwright 真实操作级 + happy-dom 静态对照）');
  console.log(line);
  console.log(
    pad('id', 22) +
      pad('category', 16) +
      pad('hit', 6) +
      pad('lossless', 10) +
      pad('residue', 8) +
      '失败原因',
  );
  console.log(line);
  for (const f of report.perFixture) {
    console.log(
      pad(f.id, 22) +
        pad(f.category, 16) +
        pad(f.hit ? 'ok' : 'FAIL', 6) +
        pad(f.losslessRate === null ? 'n/a' : f.losslessRate.toFixed(4), 10) +
        pad(String(f.residue.total), 8) +
        (f.failReasons.join('、') || ''),
    );
  }
  console.log(line);
  console.log(
    `totals: hitRate=${report.totals.hitRate}  losslessRate=${report.totals.losslessRate}  residueCount=${report.totals.residueCount}  ` +
      `editedRoundTripFidelity=${report.totals.editedRoundTripFidelity}  samples=${report.totals.samples}`,
  );
  console.log(
    `static(不参与门禁): losslessRate=${report.static.totals.losslessRate}  residueCount=${report.static.totals.residueCount}`,
  );
  console.log(
    `残留检测自检: ${report.residueDetectorSelfTest.ok ? 'ok' : 'FAIL'}（命中 ${report.residueDetectorSelfTest.actual}/5，类目 ${report.residueDetectorSelfTest.kinds.join(',')}）`,
  );
  console.log(
    `gate: ${report.gate.result}` +
      (report.gate.failed && report.gate.failed.length
        ? `  未通过：${report.gate.failed.join('；')}`
        : '') +
      (report.gate.baselineWritten ? `  已写基线：${report.gate.baselineWritten}` : ''),
  );
  console.log(`${report.durationMs} ms · JSON -> qa/report/metrics-latest.json`);
  console.log('');
}

main().catch((err) => {
  console.error('[qa:metrics] 运行失败：', err);
  process.exitCode = 1;
});
