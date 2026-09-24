// 能力探针：`file://` 下「持久化文件 handle」这条路能不能走通 —— 它是 P0-7 根治方案的唯一前提。
//
// 为什么必须实测（而不是查文档 / 推理）：
//   · Chromium 对 `file://` 的 **存储 origin** 行为特殊（所有本地文件共享同一个 origin），
//     IndexedDB 在它上面到底可不可用、可不可持久，文档没有明确保证；
//   · 项目的 P2 候选里写着「IndexedDB 持久化文件 handle（免每次弹框）」，
//     但那是一条**设想**，从没人验证过 —— 不能拿设想当前提写代码。
//
// 要回答三个问题：
//   Q1 IndexedDB 在 `file://` 上可用吗？能跨页面读回来吗？
//   Q2 `FileSystemFileHandle` 能不能结构化克隆进 IndexedDB 再取出来、并且仍然可用？
//      （没有 picker 就拿不到真文件 handle，所以用 **OPFS** 的 handle 代替测试 ——
//        两者是同一个接口、同一套序列化，机制成立则真文件 handle 也成立）
//   Q3 **content script 的隔离世界**里能用同一个 IndexedDB 吗？
//      —— 这一条最关键：handle 只能在有用户手势的 content script 里拿到，
//         而 chrome.runtime 消息传不了 handle（JSON 序列化），所以它必须落在 content script 侧。
//
// 用法：node qa/probes/file-handle-persistence.mjs   （需先 npm run build:extension）

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT_DIR = resolve('dist-extension');
const FIX_A = resolve('qa/fixtures/pick-page.html');
const FIX_B = resolve('qa/fixtures/demo-page.html');
const PROFILE_DIR = resolve('test-results/handle-probe-profile');

for (const f of [FIX_A, FIX_B]) {
  if (!existsSync(f)) {
    console.error(`[x] 缺少夹具: ${f}`);
    process.exit(1);
  }
}
mkdirSync(resolve('test-results'), { recursive: true });

const url = (p) => `file:///${p.replace(/\\/g, '/')}`;

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 800 },
});

const page = await ctx.newPage();

// 一段在主世界与隔离世界都能跑的探针代码（写成字符串，供 CDP 在指定 context 里执行）。
const PROBE_SRC = `(async () => {
  const out = { origin: location.origin, href: location.href.slice(-40) };
  out.hasIDB = typeof indexedDB !== 'undefined';
  out.hasOPFS = !!(navigator.storage && navigator.storage.getDirectory);
  if (!out.hasIDB) return out;
  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open('ep-probe', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  const put = (db, k, v) => new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
  const get = (db, k) => new Promise((res, rej) => {
    const rq = db.transaction('kv', 'readonly').objectStore('kv').get(k);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  try {
    const db = await openDb();
    out.idbOpen = true;
    // ① 普通对象往返
    await put(db, 'plain', { at: 1 });
    out.plainRoundTrip = !!(await get(db, 'plain'));
    // ② handle 往返（用 OPFS 的 handle 代替真文件 handle：同接口、同序列化）
    if (out.hasOPFS) {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('ep-probe.txt', { create: true });
      const w = await fh.createWritable();
      await w.write('hello-from-probe');
      await w.close();
      out.opfsHandleGot = true;
      await put(db, 'handle', fh);
      const back = await get(db, 'handle');
      out.handleRoundTrip = !!back;
      out.handleCtor = typeof FileSystemFileHandle !== 'undefined' && back instanceof FileSystemFileHandle;
      out.handleName = back ? back.name : null;
      if (back) {
        out.handleContent = await (await back.getFile()).text();
        try { out.perm = await back.queryPermission({ mode: 'readwrite' }); } catch (e) { out.perm = 'err:' + e.name; }
      }
    }
    db.close();
  } catch (e) {
    out.err = (e && e.name ? e.name + ': ' : '') + String(e);
  }
  return out;
})()`;

// ── Q1 / Q2：主世界 ──
await page.goto(url(FIX_A));
await page.waitForTimeout(600);
const mainA = await page.evaluate(PROBE_SRC);

// 跨页面：换一个 file:// 页面，看同一个 key 还在不在
await page.goto(url(FIX_B));
await page.waitForTimeout(400);
const mainB = await page.evaluate(`(async () => {
  const out = {};
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('ep-probe', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = (k) => new Promise((res, rej) => {
      const rq = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    const plain = await get('plain');
    out.plainSeen = !!plain;
    const h = await get('handle');
    out.handleSeen = !!h;
    if (h) {
      out.handleName = h.name;
      out.handleContent = await (await h.getFile()).text();
    }
    db.close();
  } catch (e) { out.err = String(e); }
  return out;
})()`);

// ── Q3：content script 的隔离世界 ──
await page.goto(url(FIX_A));
await page.waitForSelector('#ep-root', { timeout: 10_000 }).catch(() => {});
const cdp = await ctx.newCDPSession(page);
const contexts = [];
cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e));
await cdp.send('Runtime.enable');
await page.waitForTimeout(500);

let isolated = { note: '未找到隔离世界上下文' };
const iso = contexts.find((e) => e.context && e.context.auxData && e.context.auxData.isDefault === false);
if (iso) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: PROBE_SRC,
    contextId: iso.context.id,
    awaitPromise: true,
    returnByValue: true,
  });
  isolated = r.exceptionDetails
    ? { note: '隔离世界执行抛错', detail: JSON.stringify(r.exceptionDetails).slice(0, 300) }
    : { note: '隔离世界已执行', result: r.result.value };
}

console.log('══════════ file:// 持久化 handle 能力探针 ══════════');
console.log('【主世界 · 第 1 个 file:// 页面】');
console.log(JSON.stringify(mainA, null, 1));
console.log('\n【主世界 · 换到第 2 个 file:// 页面后读回】');
console.log(JSON.stringify(mainB, null, 1));
console.log('\n【content script 隔离世界】');
console.log(JSON.stringify(isolated, null, 1));
console.log('\n【判定】');
const q1 = mainA.hasIDB && mainA.plainRoundTrip && mainB.plainSeen;
// ⚠️ Q2 要分清「不成立」与「没测到」。`file://` 上 OPFS 直接抛 SecurityError，
// 拿不到任何 handle ⇒ 往返根本没被执行过。报「不成立」是假证据（P0-4 §4 那类错误）。
const opfsBlocked = !mainA.opfsHandleGot;
const q2 = opfsBlocked ? null : !!mainA.handleRoundTrip && mainA.handleCtor && mainA.handleContent === 'hello-from-probe';
const q3 = isolated.result ? !!isolated.result.hasIDB : false;
console.log(`Q1 IndexedDB 在 file:// 可用且跨页面保留：${q1 ? '✅ 成立' : '❌ 不成立'}`);
console.log(
  q2 === null
    ? `Q2 FileSystemFileHandle 能否存进 IndexedDB：⚠️ **未测定** —— file:// 上 OPFS 被拒（SecurityError），无 handle 可测。\n` +
      `   ⇒ 要拿到真 handle 只能靠 picker（人手门禁）。结论待 G1 脚本实测，本探针不下判断。`
    : `Q2 FileSystemFileHandle 可存可读回：${q2 ? '✅ 成立' : '❌ 不成立'}`,
);
console.log(`Q3 content script 隔离世界可用 IndexedDB：${q3 ? '✅ 成立' : '❌ 不成立/未取到'}`);

console.log('\n【对方案的含义】');
console.log('Q1+Q3 成立 ⇒ 「handle 存 IDB」这条路的**存储侧**是通的，且能在 content script 里做。');
console.log('Q2 未测定 ⇒ 不能拿它当前提。P0-7 必须写成「尽力而为 + 优雅退化」：');
console.log('            idb 里取不到 handle / permission 不是 granted ⇒ 一律退回现有 picker 流程。');

await ctx.close();
