// `showSaveFilePicker({ startIn })` 到底接不接受一个**目录句柄**？
//
// ⛔️ **2026-09-23 起本探针已退出产品链路的守卫范围。**
// 静默保存把保存框（`showSaveFilePicker`）从产品里整体删掉了（见 `src/extension/dir-save.ts`
// 文件头）—— 现在保存只用目录句柄直接写盘，`startIn` 只出现在**目录框**上。
// 本文件**保留不删**，理由是它记着一条仍然有效的能力事实（`startIn` 收目录句柄，
// 差分对照可判），而 `dir-save.ts` 的目录框 `startIn` 用的是**同一套取值**；
// 将来若有人想给保存框加回来，这里是第一手证据。
// ⚠️ 但它**不再**是任何产品行为的判据：不要拿它的绿来推断保存流程正常。
//
// 为什么当初必须先量：用户选定的保存流程是「点保存 → 系统框**自动定位到原文件所在处** → 再点保存」。
// 唯一能让框停到指定目录的 API 是 `startIn`，而 `startIn` 除了 well-known 目录名（`'documents'` 等）
// 之外，规范上还允许传一个 **FileSystemHandle**。这条在 `file://` 上是否真的被 Chrome 接受，决定
// 「自动定位」能不能成立 —— 不能凭标准文档下结论。
//
// ⚠️ 本探针量的是**选项是否被接受**，判别式 = 拒绝时的**错误类型**：
//    · `TypeError`   ⇒ 选项值被拒（校验不过）
//    · `AbortError`  ⇒ **选项通过了**，只是框没开成（无头环境没有用户手势）
//    **不是**「框弹出来停在哪」—— 后者是 OS 级窗口行为，Playwright 与 CDP 都观测不到，
//    只能进人手门禁。这里如实分开标注，不混成一个读数。
//
// 🔴 第一版我把「被拒」写成「**同步**抛 TypeError」，跑出来 2 项 FAIL —— 实测是**异步拒绝**
//    （`syncThrew` 五格全为 null，`TypeError` 出现在 promise rejection 里）。
//    这正是我自己那份 skill 里新写的第三副面孔：**期望值本身写错（写在了错误的通道上）**。
//    测量没错，是我把判据挂错了地方。判别式改成「错误类型」后，那个「伪句柄被拒」的差分对照
//    仍然是成立的，而且更有力：真句柄与已知合法的 `'documents'` 拿到**同一个**失败类型。
//
// 怎么拿到一个真的目录句柄：`file://` 上 OPFS 被拒（拿不到任何句柄），
// 所以本探针起一个**本地 http 服务**，在 http 源上用 `navigator.storage.getDirectory()` 拿 OPFS 根目录句柄
// —— 它是货真价实的 `FileSystemDirectoryHandle`，足以用来问「这个选项收不收句柄」。
//
// 用法：node qa/probes/save-picker-startin-capability.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT_DIR = join(REPO, 'test-results', 'capability');
mkdirSync(OUT_DIR, { recursive: true });

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>startIn probe</title></head>
<body><p id="ok">ready</p></body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/**
 * 在页面里跑一次 `showSaveFilePicker(opts)`，把结果分成可读的几态。
 *
 * ⚠️ 必须**自包含**：`page.evaluate` 会把函数体序列化后丢进页面执行，闭包变量一个都拿不到。
 */
const TRY_OPTS = (optsSpec) =>
  // eslint-disable-next-line no-undef
  (async () => {
    const HAS = {
      showSaveFilePicker: typeof window.showSaveFilePicker,
      showDirectoryPicker: typeof window.showDirectoryPicker,
    };
    let opfsDir = null;
    let opfsErr = null;
    try {
      opfsDir = await navigator.storage.getDirectory();
    } catch (e) {
      opfsErr = `${e.name}: ${e.message}`;
    }

    const build = (spec) => {
      if (spec === 'OPFS_DIR') return opfsDir;
      if (spec === 'FAKE_BRAND') return { kind: 'directory' };
      return spec;
    };

    // 同步抛错（= 选项被拒）与异步拒绝（= 选项通过，但框没开成 / 被环境回绝）**必须分开读**，
    // 否则「选项被拒」和「没有用户手势」会混成同一个读数。
    const out = { has: HAS, opfsDirGot: !!opfsDir, opfsErr, syncThrew: null };
    try {
      const p = window.showSaveFilePicker({ startIn: build(optsSpec.startIn) });
      out.verdict = await Promise.race([
        p.then(
          () => 'resolved-with-handle',
          (e) => `rejected:${e.name}`,
        ),
        new Promise((r) => setTimeout(() => r('timeout'), 1200)),
      ]);
    } catch (e) {
      out.syncThrew = `${e.name}: ${String(e.message).slice(0, 120)}`;
    }
    return out;
  })();

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`);

const matrix = [
  ['无 startIn（对照基线）', { startIn: undefined }],
  ["startIn: 'documents'（well-known 目录名）", { startIn: 'documents' }],
  ['🔴 startIn: <真·OPFS 目录句柄>', { startIn: 'OPFS_DIR' }],
  ['⚠️ startIn: {kind:"directory"}（伪句柄，应被拒）', { startIn: 'FAKE_BRAND' }],
  ['startIn: 数字 123（非法值，应被拒）', { startIn: 123 }],
];

const rows = [];
for (const [label, spec] of matrix) {
  const r = await page.evaluate(TRY_OPTS, spec);
  rows.push({ label, ...r });
}
await ctx.close();
await browser.close();
server.close();

writeFileSync(join(OUT_DIR, 'save-picker-startin-capability.json'), JSON.stringify(rows, null, 2), 'utf8');

const results = [];
const check = (name, fn) => {
  try {
    results.push({ name, ok: true, detail: String(fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 220) });
  }
};
const by = (frag) => rows.find((r) => r.label.includes(frag));
const baseline = by('无 startIn');
const wellKnown = by('well-known');
const dirHandle = by('真·OPFS');
const fakeBrand = by('伪句柄');
const bogus = by('数字 123');

/** 把一行读数分成「选项被拒」还是「选项通过」。判别式 = 错误类型（TypeError = 被拒）。 */
const classify = (row) => {
  if (row.syncThrew) return /TypeError/.test(row.syncThrew) ? 'rejected' : 'other-sync';
  if (/TypeError/.test(row.verdict || '')) return 'rejected';
  if (!row.verdict) return 'unknown';
  return 'accepted';
};
const kind = (row) => (row.syncThrew ? `sync:${row.syncThrew.slice(0, 40)}` : row.verdict);

check('前提：该源上 `showSaveFilePicker` / `showDirectoryPicker` 都存在', () => {
  if (baseline.has.showSaveFilePicker !== 'function') throw new Error(`showSaveFilePicker = ${baseline.has.showSaveFilePicker}`);
  if (baseline.has.showDirectoryPicker !== 'function') throw new Error(`showDirectoryPicker = ${baseline.has.showDirectoryPicker}`);
  return `showSaveFilePicker=${baseline.has.showSaveFilePicker} showDirectoryPicker=${baseline.has.showDirectoryPicker}`;
});
check('前提：拿到了一个**真的** FileSystemDirectoryHandle（否则整轮无意义）', () => {
  if (!baseline.opfsDirGot) throw new Error(`拿不到 OPFS 句柄：${baseline.opfsErr}`);
  return 'navigator.storage.getDirectory() 成功';
});
check('前提：五格都**没有同步抛错** ⇒ 选项校验是**异步**的（下次别把断言写在同步通道上）', () => {
  const bad = rows.filter((r) => r.syncThrew).map((r) => r.label);
  if (bad.length) throw new Error(`这些格子同步抛错了：${bad.join('、')}`);
  return '全部为异步拒绝';
});
check("对照：`startIn: 'documents'` 被**接受**（说明 startIn 这个选项本身是通的）", () => {
  if (classify(wellKnown) !== 'accepted') throw new Error(`被拒了：${kind(wellKnown)}`);
  return kind(wellKnown);
});
check('🔴 决定性：`startIn: <真·目录句柄>` 被**接受**（⇒「自动定位到原文件所在处」可落地）', () => {
  if (classify(dirHandle) !== 'accepted') throw new Error(`被拒了：${kind(dirHandle)}`);
  return kind(dirHandle);
});
check('🔴 且它与已知合法的 `documents` 拿到**同一个**失败类型（= 同类，不是碰巧放行）', () => {
  if (kind(dirHandle) !== kind(wellKnown)) {
    throw new Error(`真句柄 ${kind(dirHandle)} ≠ documents ${kind(wellKnown)}`);
  }
  return `两者都是 ${kind(dirHandle)}`;
});
check('⚠️ 反向确认：`startIn: {kind:"directory"}` 伪句柄必须**被拒**（否则上面那条是假阳性）', () => {
  if (classify(fakeBrand) !== 'rejected') throw new Error(`竟然被接受了：${kind(fakeBrand)}`);
  return kind(fakeBrand);
});
check('⚠️ 反向确认：`startIn: 123` 也必须**被拒**', () => {
  if (classify(bogus) !== 'rejected') throw new Error(`竟然被接受了：${kind(bogus)}`);
  return kind(bogus);
});

console.log('\n══════════ showSaveFilePicker({ startIn }) 能力探针 ══════════');
console.log(`探针页面：http://127.0.0.1:${PORT}/（http 源，好拿到真 OPFS 句柄）\n`);
for (const r of rows) {
  console.log(`── ${r.label} ──`);
  if (r.syncThrew) console.log(`  同步抛错（选项被拒）: ${r.syncThrew}`);
  else console.log(`  同步未抛错 ✅ · 异步读数: ${r.verdict}`);
}
console.log('\n── 断言明细 ──');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.detail}`);
const pass = results.filter((r) => r.ok).length;
console.log(`\n共 ${results.length} 项，通过 ${pass}，失败 ${results.length - pass}`);
console.log(
  '⚠️ 本探针**不覆盖**：「框弹出来之后停在哪个目录」—— OS 级窗口行为，Playwright 与 CDP 都观测不到，',
);
console.log('   只能由人手门禁 G1 确认（见 qa/report/verify-p0-9.md）。');
console.log(`JSON → ${join(OUT_DIR, 'save-picker-startin-capability.json')}\n`);
