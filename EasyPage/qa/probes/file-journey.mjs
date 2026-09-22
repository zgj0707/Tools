#!/usr/bin/env node
/**
 * qa/probes/file-journey.mjs · 单文件产物「完整用户旅程」探针
 *
 * 与 file-smoke.mjs 的分工：
 *   file-smoke   只回答「file:// 能不能打开、挂载、有无报错」。
 *   file-journey 回答「file:// 下能不能真的干活」—— 走一遍端到端旅程：
 *       空态浮层 → 粘贴/导入 → 画布渲染（脚本不执行）→ 就地改字
 *       → 面板开关（依赖 localStorage）→ 导出（Blob + a[download]）→ 复制 HTML
 *   每一次点击之后都断言「无 pageerror / console error」，
 *   最后核对导出的 HTML 是否干净（不含 ep- 前缀与 contenteditable）。
 *
 * 用法：node qa/probes/file-journey.mjs [dist 路径] [--headed]
 *   --headed 用真实浏览器窗口运行。剪贴板权限在 headless 下可能表现为
 *   「prompt 且不可自动授予」，headed 才能反映真实用户环境，用于交叉验证。
 * 退出码：0=全部通过；1=有步骤失败；2=找不到目标文件。
 *
 * 两条已知行为（均已实测，非故障）：
 *   1) 导入的 HTML 含 <script> 时，Chrome 会对被 sandbox 拦截的内联脚本发一条
 *      error 级消息（"Blocked script execution in 'about:srcdoc'"）。这是编辑态
 *      「脚本不执行」安全设计生效的证据，列入 KNOWN_BENIGN 白名单，不算故障。
 *   2) 「复制 HTML」的结果取决于剪贴板写权限状态，而不取决于 file:// 本身：
 *      file:// 实测 isSecureContext=true、hasFocus=true、navigator.clipboard 存在，
 *      但 permissions.query('clipboard-write') 停在 "prompt"，headless 下无法自动
 *      授予 → writeText 抛 NotAllowedError → 降级为「复制失败，请用下载导出」。
 *      一旦权限为 granted（例如真实窗口或显式授权），同一调用即成功。
 *      http://localhost 下实测直接走成功分支，见 qa/probes/clipboard-http.mjs。
 *      故本探针只断言「不崩 + 有明确反馈」，具体分支记入 outcome 字段。
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function targetOf(arg) {
  if (!arg) return resolve(repoRoot, 'dist/index.html');
  const p = isAbsolute(arg) ? arg : resolve(repoRoot, arg);
  if (existsSync(p) && p.endsWith('.html')) return p;
  return resolve(p, 'index.html');
}

// 只把非 `--` 开头的参数当作目标路径，避免把 --headed 之类的开关误当路径。
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const target = targetOf(positional[0]);
if (!existsSync(target)) {
  console.error(`RESULT ${JSON.stringify({ ok: false, error: 'target not found', target })}`);
  process.exit(2);
}

const FIXTURE = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>旅程样例</title></head>
<body>
  <div class="hero" id="hero-block">
    <h2>原始标题</h2>
    <p>一段说明文字</p>
  </div>
  <button class="btn" type="button" onclick="window.__ran=true">了解更多</button>
  <script>window.__ran = true; console.log('fixture script ran');</script>
</body>
</html>`;

const shotDir = resolve(repoRoot, 'test-results');
mkdirSync(shotDir, { recursive: true });
const shotPath = resolve(shotDir, 'file-journey.png');

const steps = [];
const errors = [];
const warnings = [];
function record(name, ok, detail) {
  steps.push({ step: name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) errors.push(`${name}: ${detail}`);
}

const headed = process.argv.includes('--headed');
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`));

// 抓导出 Blob：在页面加载前挂钩 URL.createObjectURL。
await page.addInitScript(() => {
  window.__capturedBlob = null;
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__capturedBlob = blob;
    return orig(blob);
  };
});

/**
 * 已知无害的浏览器消息白名单。
 *
 * 当导入的 HTML 里带 <script> 时，编辑态 iframe 因 sandbox 未开 allow-scripts，
 * Chrome 会对被拦截的内联脚本发一条 error 级消息：
 *   "Blocked script execution in 'about:srcdoc' because the document's frame
 *    is sandboxed and the 'allow-scripts' permission is not set."
 * 这正是「编辑态脚本不执行」这条安全设计**生效的证据**，不是故障：
 * 预览态（sandbox=allow-scripts）下同一份 HTML 的脚本可正常运行（见 walking-skeleton）。
 *
 * 因此断言口径是「零**非预期**报错」，白名单命中项单独列在 expectedLogs 里对账，
 * 不隐藏、不丢弃。
 */
const KNOWN_BENIGN = [/Blocked script execution in 'about:srcdoc'/];
const isBenign = (l) => KNOWN_BENIGN.some((re) => re.test(l));

/** 每次交互后清点新增的非预期硬错误。 */
function errorsSince(mark) {
  return logs
    .slice(mark)
    .filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))
    .filter((l) => !isBenign(l));
}
/** 新增的预期内消息，用于对账（不参与判定）。 */
function benignSince(mark) {
  return logs
    .slice(mark)
    .filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))
    .filter(isBenign);
}

let downloadName = null;
try {
  // ── 0. 打开 file:// 单文件产物 ────────────────────────────────────────
  const mark0 = logs.length;
  await page.goto(pathToFileURL(target).href, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(800);
  const boot = await page.evaluate(async () => {
    let permClipboardWrite = 'n/a';
    try {
      permClipboardWrite = (await navigator.permissions.query({ name: 'clipboard-write' })).state;
    } catch (e) {
      permClipboardWrite = `ERR:${e.name}`;
    }
    return {
      title: document.title,
      hasApp: !!document.getElementById('ep-app'),
      children: document.getElementById('ep-app')?.childElementCount ?? -1,
      isFile: location.protocol === 'file:',
      // 剪贴板可用性取决于「安全上下文 + 权限状态 + 用户激活」三者。
      // 把三个判据都采集下来，避免只凭结果反推原因。
      isSecureContext: window.isSecureContext,
      clipboardType: typeof navigator.clipboard,
      hasFocus: document.hasFocus(),
      permClipboardWrite,
      localStorageOk: (() => {
        try {
          localStorage.setItem('__probe__', '1');
          localStorage.removeItem('__probe__');
          return true;
        } catch {
          return false;
        }
      })(),
    };
  });
  record('打开 file:// 产物', boot.isFile && boot.hasApp && boot.children > 0, boot);
  record('打开阶段零报错', errorsSince(mark0).length === 0, errorsSince(mark0));

  // ── 1. 空态：导入浮层应强制可见 ──────────────────────────────────────
  const mark1 = logs.length;
  const overlayOpen = await page.locator('.ep-import-overlay').getAttribute('data-open');
  const textareaVisible = await page.locator('textarea').isVisible();
  record('空态导入浮层可见', overlayOpen === 'true' && textareaVisible, { overlayOpen, textareaVisible });
  await page.screenshot({ path: resolve(shotDir, 'file-journey-empty.png') });

  // ── 2. 粘贴 + 导入 ──────────────────────────────────────────────────
  await page.locator('textarea').fill(FIXTURE);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(600);

  const frame = page.frameLocator('#ep-canvas-frame');
  const h2 = frame.locator('h2').first();
  await h2.waitFor({ state: 'attached', timeout: 8000 });
  const h2Text = await h2.textContent();
  record('导入后画布渲染', h2Text?.trim() === '原始标题', { h2Text });

  // 脚本不执行（编辑态）
  const scriptRan = await page.evaluate(() => {
    const f = document.querySelector('#ep-canvas-frame');
    return typeof f?.contentWindow?.__ran;
  });
  record('编辑态脚本不执行', scriptRan === 'undefined', { typeofRan: scriptRan });
  record('导入阶段零非预期报错', errorsSince(mark1).length === 0, {
    unexpected: errorsSince(mark1),
    expectedBenign: benignSince(mark1),
  });

  // 导入成功后浮层应收起
  const overlayAfter = await page.locator('.ep-import-overlay').getAttribute('data-open');
  record('导入后浮层自动收起', overlayAfter === 'false', { overlayAfter });

  // ── 3. 就地改字 ────────────────────────────────────────────────────
  const mark3 = logs.length;
  await h2.dblclick();
  await h2.fill('改后的标题XYZ');
  await page.locator('h1').first().click(); // 把焦点从 iframe 收回主文档，触发 blur
  await page.waitForTimeout(300);
  const h2After = await h2.textContent();
  record('双击就地改字生效', h2After?.trim() === '改后的标题XYZ', { h2After });
  record('改字阶段零报错', errorsSince(mark3).length === 0, errorsSince(mark3));

  // ── 4. 面板开关（依赖 localStorage，file:// 下的关键风险点）────────────
  const mark4 = logs.length;
  const leftOpen = await page.locator('#ep-app').getAttribute('data-left');
  await page.locator('.ep-topbar__toggle[data-panel="left"]').click();
  await page.waitForTimeout(250);
  const leftAfter = await page.locator('#ep-app').getAttribute('data-left');
  const elementsVisible = await page.locator('aside.ep-elements').first().isVisible();
  record('面板开关可用', leftOpen === 'closed' && leftAfter === 'open' && elementsVisible, {
    leftOpen,
    leftAfter,
    elementsVisible,
  });
  // 落盘：重新加载后偏好应被记住
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  const leftPersisted = await page.locator('#ep-app').getAttribute('data-left');
  record('面板偏好持久化', leftPersisted === 'open', { leftPersisted, localStorageOk: boot.localStorageOk });
  // 复选：再导入一次，恢复有文档状态以便导出
  await page.locator('textarea').fill(FIXTURE);
  await page.getByRole('button', { name: '导入 HTML' }).click();
  await page.waitForTimeout(600);
  const h2b = page.frameLocator('#ep-canvas-frame').locator('h2').first();
  await h2b.dblclick();
  await h2b.fill('改后的标题XYZ');
  await page.locator('h1').first().click();
  await page.waitForTimeout(300);
  record('面板阶段零非预期报错', errorsSince(mark4).length === 0, {
    unexpected: errorsSince(mark4),
    expectedBenign: benignSince(mark4),
  });

  // ── 5. 导出 HTML ───────────────────────────────────────────────────
  const mark5 = logs.length;
  let downloadOk = false;
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 6000 }),
      page.getByRole('button', { name: '导出 HTML' }).click(),
    ]);
    downloadName = dl.suggestedFilename();
    downloadOk = true;
  } catch {
    warnings.push('file:// 下未捕获到 download 事件（Blob 仍可用于校验导出内容）');
    await page.getByRole('button', { name: '导出 HTML' }).click();
  }
  await page.waitForTimeout(400);
  const exported = await page.evaluate(async () => {
    const b = window.__capturedBlob;
    return b ? await b.text() : '';
  });
  record('导出下载触发', downloadOk, { downloadName });
  record('导出内容非空', exported.length > 0, { length: exported.length });
  record('导出不含编辑器痕迹', !exported.includes('contenteditable') && !/\bep-/.test(exported), {
    hasContenteditable: exported.includes('contenteditable'),
    hasEpPrefix: /\bep-/.test(exported),
  });
  record('导出保留改动', exported.includes('改后的标题XYZ'), {
    includesEditedText: exported.includes('改后的标题XYZ'),
  });
  record('导出阶段零报错', errorsSince(mark5).length === 0, errorsSince(mark5));

  // ── 6. 复制 HTML（file:// 下剪贴板可能不可用，只要求「不崩 + 有反馈」）──
  const mark6 = logs.length;
  await page.getByRole('button', { name: '复制 HTML' }).click();
  await page.waitForTimeout(400);
  const toastText = await page
    .locator('.ep-toast')
    .first()
    .textContent()
    .catch(() => null);
  const copyCrashed = errorsSince(mark6).length > 0;
  const degraded = /复制失败/.test(toastText || '');
  const succeeded = /导出成功/.test(toastText || '');
  // 剪贴板结果随「权限状态」而变：headless 下 clipboard-write 停在 prompt 且无法
  // 自动授予 → 走降级分支；headed（真实窗口）下可自动授予 → 走成功分支。
  // 因此这里断言的是「不崩且给出明确反馈」，具体走哪个分支记入 outcome，
  // 不用单一期望值把环境差异判成故障。
  record('复制 HTML 不崩且有明确反馈', !copyCrashed && (degraded || succeeded), {
    toastText: toastText?.trim(),
    outcome: degraded ? 'degraded' : succeeded ? 'copied' : 'unknown',
    isSecureContext: boot.isSecureContext,
    clipboardType: boot.clipboardType,
    hasFocus: boot.hasFocus,
    permClipboardWrite: boot.permClipboardWrite,
  });
  if (degraded) {
    warnings.push(
      `剪贴板写入被拒（isSecureContext=${boot.isSecureContext}, hasFocus=${boot.hasFocus}, ` +
        `permClipboardWrite=${boot.permClipboardWrite}），已按设计降级为「复制失败，请用下载导出」；` +
        '导出下载在本探针中已验证可用。',
    );
  }

  // ── 7. 收尾截图 ────────────────────────────────────────────────────
  await page.screenshot({ path: shotPath });
} catch (e) {
  record('探针执行未抛异常', false, e.message);
} finally {
  await browser.close();
}

const hardErrors = logs.filter((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'));
const unexpectedErrors = hardErrors.filter((l) => !isBenign(l));
const expectedLogs = hardErrors.filter(isBenign);
const ok = errors.length === 0 && unexpectedErrors.length === 0;
console.log(
  'RESULT ' +
    JSON.stringify(
      {
        ok,
        mode: headed ? 'headed' : 'headless',
        target,
        steps,
        failedSteps: errors,
        warnings,
        unexpectedErrors,
        expectedLogs,
        requestFailures: logs.filter((l) => l.startsWith('[reqfail]')),
        screenshots: { journey: shotPath, empty: resolve(shotDir, 'file-journey-empty.png') },
      },
      null,
      2,
    ),
);
process.exit(ok ? 0 : 1);
