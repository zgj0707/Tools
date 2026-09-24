// 「自包含」另存能力探针 —— **跑的是产品变换本身**，不是探针自带的简化版。
//
// ── 它回答的问题 ──
// 用户对保存的规格（P0-9，第五轮下载口径）：① 点保存 → 副本交给浏览器下载（落下载文件夹）；
// ② 名字加后缀（`原名_改.html`），重名由浏览器自动加 `(1)`；
// ③ 🔴 **副本必须自包含，能直接拉出去分享**。
// 第 ③ 条推翻了 P0-8 的 `<base href="../">` 方案（那一版依赖留在原处，副本离开原目录就废）。
//
// ── 🔴 这一版改了什么（口径升级）──
// 上一版自带走一套「够用就好」的字符串替换，只回答了「**内联这条路**行不行」。
// 于是「自包含」这个结论实际上缺了最关键的一格：**产品变换 → 真浏览器 → 拷出去仍能用**。
// 现在改成：把 `src/extension/` 用 esbuild 就地在内存里打包成一段脚本注入页面，然后在页面里
// 直接调用产品的 `saveCopy()` 产出副本 —— 走的是**真实管线**：
//      cloneForSave（克隆+清理）→ residueBlocker（残留护栏）→ 只读目录句柄（记忆/框）
//      → inlineDependencies（内联）→ insertBase（读不到时的兜底）→ **下载落盘**
// 被替换掉的只有两样，都属于「自动化不了 / 不必自动化」：
//   · **OS 级只读目录框**（`showDirectoryPicker`）—— 属人手门禁 G1。用**形状与 FSA 一致的
//     假目录句柄**顶上，让 `dirReader(dir)` 也走真实代码路径（真句柄能不能读字节＝G1）；
//   · **下载管线的最后一程**（下载气泡 / 真正落盘到下载文件夹 / 重名加 `(1)`）—— 浏览器 UI。
//     用替身下载管线截住：patch `URL.createObjectURL` + `<a>.click()`，把产品**交给**浏览器的
//     Blob 与文件名截下来读回字节。「交出去的东西对不对」这里量，「落盘那一步」已由
//     `download-write-capability.mjs`（4/4）在真浏览器取证。
// 🔴 2026-09-23 傍晚（第五轮）后 `CopyIO` 里**只剩** `dirPicker` 与 `store` 两个可替换点：
//    FSA 写盘在整条链路上不可表达（没有写入式句柄参数），保存框/写权限更是无从谈起。
// ⚠️ 因此这个探针跑的是 **src**（esbuild 现场打包），不是 `dist-extension` 里的 `content.js` ——
//    `content.js` 是个自动执行的 IIFE，不暴露可传参的 API。编译链路与 vite 同源。
//
// ── 因此本探针顺带覆盖了上一版明确标为「未覆盖」的四项 ──
// `defer` 内联后的时序、`@import` 递归展开、css 内相对 `url()` 的基准、`srcset`。
//
// 结构（`test-results/probe-selfcontain/`）：
//   proj/                        ← 原目录，依赖都在这里，全程不动
//     index.html · styles.css · extra/theme.css · app.js · fig1.png · bg.png
//     assets/deep.png · data.json
//   elsewhere/                   ← 模拟「拉出去」：里面**只有 html**，没有任何依赖
//     product-inlined.html       ← 产品变换产出，应当**全活**
//     plain.html                 ← 反向确认：只是原样复制，应当**三样全坏**
//   elsewhere-base/              ← 兜底场景（有两个依赖读不到）
//     product-base-only.html     ← 产品把**那两条读不到的引用改写成绝对 URL** ⇒ 能用，
//                                    但**不再自包含**（文件名沿用第六轮，当时这里放的是 base 兜底）
//
// 反向确认那一份是刻意的：若两种都「能用」，说明内联根本不是起作用的那个因。
//
// ── 🔴 三条判据纪律（都是这一版真踩到的，写在这儿防复发）──
// 1. **喂给页面的字节必须真的是字节。** `new Uint8Array('一串字符串')` 不做编码 —— 它按
//    `.length` 造一个**全 0 数组**。第一稿就栽在这里：css/js 变成一串 NUL，被内联成「非空但
//    全是 NUL」的内容，产物看着「该内联的都内联了」而样式脚本全死，10 条断言一起红成产品回归。
//    ⇒ `夹具自检` 那条断言就是为此而设：**开浏览器之前**先把字节还原一遍。
// 2. **不许用正则去产物里数「某个词还剩没剩」。** 第一稿用 `/@import/` 判「@import 有没有展开」，
//    结果匹配到的是夹具自己那段可见文字 `<p id="imported">@import 展开测试</p>` —— 判据被自己的
//    夹具点亮。（同类前科：`href=` 正则命中 `data-href="x"`，误报 110 个假依赖。）
// 3. **`naturalWidth` 不是「加载成功」的判据** —— 它**按候选的密度折算**：`srcset` 里一个 1×1 的
//    `2x` 候选，`naturalWidth` 是 `1/2` 取整 = **0**。第一稿拿 `naturalWidth > 0` 判 srcset 图，
//    把「浏览器选了 2x 候选」误报成「图加载失败」。
//    ⇒ 判据改用 `img.decode()`（解码成功才 resolve，坏图解 reject），并把尺寸也一并报出来：
//      夹具里三张图的尺寸**互不相同**，于是「加载的是哪一张」也顺带被证了。
//
// 用法：node qa/probes/selfcontain-capability.mjs
// 不做的事：不开有头窗口、不弹任何原生框、不动 `file://` 之外的任何东西。

import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const ROOT = join(REPO, 'test-results', 'probe-selfcontain');
const PROJ = join(ROOT, 'proj');
const ELSE = join(ROOT, 'elsewhere');
const ELSE_BASE = join(ROOT, 'elsewhere-base');
const OUT_DIR = join(REPO, 'test-results', 'capability');
mkdirSync(join(PROJ, 'assets'), { recursive: true });
mkdirSync(join(PROJ, 'extra'), { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });
// 只清我们自己的两个产物目录 —— 里面本来就只该有 html，留着旧的会让「只有 html」那条断言失去意义。
rmSync(ELSE, { recursive: true, force: true });
rmSync(ELSE_BASE, { recursive: true, force: true });
mkdirSync(ELSE, { recursive: true });
mkdirSync(ELSE_BASE, { recursive: true });

// ── 断言收集器 ──
// 提前定义（而不是等到开浏览器前）：夹具自检要能在**开浏览器之前**就报出「夹具坏了」，
// 否则夹具的错误会伪装成一整屏「产品回归」。
const results = [];
const check = (name, fn) => {
  try {
    results.push({ name, ok: true, detail: String(fn()) });
  } catch (err) {
    results.push({ name, ok: false, detail: String(err).split('\n')[0].slice(0, 240) });
  }
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ── 手写 PNG（不引第三方库）：尺寸互不相同，好让「加载的是哪一张」可证 ──
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** 一张 w×h 的纯色 RGBA PNG。 */
function makePng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.concat(
    Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 4, 0x80)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PNG_ROOT = makePng(3, 5); // fig1.png
const PNG_BG = makePng(5, 5); // bg.png（css 背景图）
const PNG_DEEP = makePng(7, 11); // assets/deep.png（子目录图）

// ── 夹具：四类依赖各一份（css + 子目录 css + js + 根图 + 子目录图 + srcset）──
const SOURCE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>selfcontain probe</title>
<link rel="stylesheet" href="styles.css">
<script src="app.js" defer></script>
<style>#inlineBg { background-image: url(bg.png); width: 4px; height: 4px; }</style>
</head><body>
<h1 id="h">selfcontain probe</h1>
<p id="tick">脚本还没跑起来。</p>
<p id="imported">子目录 css 已展开</p>
<img id="pic" src="fig1.png" alt="">
<img id="pic2" src="assets/deep.png" alt="">
<img id="set" srcset="fig1.png 1x, assets/deep.png 2x" src="fig1.png" alt="">
<div id="cssBg"></div><div id="deepBg"></div><div id="inlineBg"></div><div id="themeBg"></div>
<a id="anchor" href="#top">anchor</a>
</body></html>`;

const STYLES_CSS = `@import "extra/theme.css";
#h { color: rgb(22, 93, 255); }
#cssBg { background-image: url(bg.png); width: 4px; height: 4px; }
#deepBg { background-image: url(assets/deep.png); width: 4px; height: 4px; }
`;
// 子目录里的 css：`url(../fig1.png)` 考的是「css 内相对路径相对**那个 css** 解析」。
const THEME_CSS = `#imported { color: rgb(1, 2, 3); }
#themeBg { background-image: url(../fig1.png); width: 4px; height: 4px; }
`;
// 🔴 `defer` 是这里最关键的一味：它原本在 `<head>`，内联后 `defer` 失效会被**立即执行**，
//    此时 body 还不存在 ⇒ `getElementById('tick')` 是 null ⇒ 抛错、文字不变。
//    ⇒ 下面那条「脚本真的跑起来了」的断言，同时就是「产品有没有把 defer 脚本挪到 </body> 前」的判据。
const APP_JS = `document.getElementById('tick').textContent = '脚本已跑起来';
/* 文本标记-DEFER */
`;

const FIXTURE = {
  'index.html': SOURCE,
  'styles.css': STYLES_CSS,
  'extra/theme.css': THEME_CSS,
  'app.js': APP_JS,
  'fig1.png': PNG_ROOT,
  'bg.png': PNG_BG,
  'assets/deep.png': PNG_DEEP,
  'data.json': Buffer.from('{"probe":"data-marker"}\n', 'utf8'),
};
for (const [rel, body] of Object.entries(FIXTURE)) {
  writeFileSync(join(PROJ, ...rel.split('/')), body);
}
const SOURCE_BYTES = readFileSync(join(PROJ, 'index.html'));

// 🔴 交给页面的必须是**真正的字节**（见文件头纪律 1）。
const toBytes = (v) => Array.from(typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v));
const FILES_BYTES = Object.fromEntries(Object.entries(FIXTURE).map(([k, v]) => [k, toBytes(v)]));

check('🔴 夹具自检：喂给页面的字节能还原成原文（文本类非零字节且含关键字）', () => {
  const dec = (k) => new TextDecoder().decode(Uint8Array.from(FILES_BYTES[k]));
  ok(dec('styles.css').includes('#h'), 'styles.css 还原不出原文 —— 字节在传递途中丢了/错了');
  ok(dec('styles.css').includes('@import'), 'styles.css 里没有 @import，这条链路就测不到了');
  ok(dec('extra/theme.css').includes('#imported'), 'extra/theme.css 内容不对');
  ok(dec('app.js').includes('文本标记-DEFER'), 'app.js 内容不对');
  ok(FILES_BYTES['fig1.png'].length === PNG_ROOT.length, 'PNG 字节长度不对（二进制也被编码坏过）');
  ok(new Set([PNG_ROOT.length, PNG_BG.length, PNG_DEEP.length]).size === 3, '三张图字节数相同，就分不出加载了哪张');
  return `styles.css ${FILES_BYTES['styles.css'].length}B · theme.css ${FILES_BYTES['extra/theme.css'].length}B · app.js ${FILES_BYTES['app.js'].length}B · png 3×5/5×5/7×11`;
});

const HREF = pathToFileURL(join(PROJ, 'index.html')).href;
// `insertBase` 会拿它当兜底 base；比对时统一小写 —— `pathToFileURL` 盘符是小写，浏览器会规范成大写。
const PROJ_DIR_URL = new URL('.', HREF).href;

// ── 就地把产品代码打成一段脚本（内存里，不落盘）──
// 用 stdin 当入口，避免为探针往仓库里塞一个只服务测试的 .ts 文件（那个文件还要过 tsc/eslint）。
const ENTRY = `
export { saveCopy, inlineDepsForSave, dirReader, copyNameOf } from './src/extension/copy-save';
export { inlineDependencies } from './src/extension/inline-deps';
export { cloneForSave, serializeDocument, insertBase, countFragmentAnchors } from './src/extension/save';
`;
const built = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: REPO, sourcefile: 'ep-probe-entry.ts', loader: 'ts' },
  bundle: true,
  format: 'iife',
  globalName: 'EPProbe',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
  write: false,
});
const BUNDLE = built.outputFiles[0].text;

// ── 页面侧：用假目录句柄 + 替身下载管线跑产品管线 ──
// ⚠️ 这个函数会被 Playwright 序列化后丢进页面执行 ⇒ **必须自包含**（一个闭包变量都拿不到）。
const RUN_PRODUCT = async (arg) => {
  const EP = window.EPProbe;
  const bytes = {};
  for (const [k, v] of Object.entries(arg.files)) bytes[k] = Uint8Array.from(v);
  const isDir = (key) => Object.keys(bytes).some((f) => f.startsWith(`${key}/`));
  const dirOf = (prefix) => ({
    name: prefix ? prefix.split('/').pop() : 'proj',
    kind: 'directory',
    queryPermission: async () => 'granted',
    getDirectoryHandle: async (name) => {
      const key = prefix ? `${prefix}/${name}` : name;
      if (!isDir(key)) throw new DOMException(`${key} 不存在`, 'NotFoundError');
      return dirOf(key);
    },
    getFileHandle: async (name) => {
      const key = prefix ? `${prefix}/${name}` : name;
      if (!(key in bytes)) throw new DOMException(`${key} 不存在`, 'NotFoundError');
      return {
        name,
        kind: 'file',
        queryPermission: async () => 'granted',
        getFile: async () => ({ arrayBuffer: async () => bytes[key].slice().buffer }),
      };
    },
  });
  const root = dirOf('');

  // 🔴 替身下载管线：截住产品交给浏览器的最后一跳（Blob + `<a download>` + click()）。
  //    真实下载（气泡 / 落盘下载文件夹 / 重名自动 `(1)`）属浏览器 UI ⇒ G1；
  //    这里验的是「产品**交出去**的东西对不对」—— 名字、字节、内容。
  const handed = []; // { url, blob, name }
  URL.createObjectURL = (blob) => {
    const url = `blob:probe-${handed.length}`;
    handed.push({ url, blob, name: null });
    return url;
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {
    const rec = handed.find((x) => x.url === this.getAttribute('href'));
    if (rec) rec.name = this.getAttribute('download');
  };

  /** 目录框被调用的累计次数 —— 方案 A 下它只在「内联依赖」动作里被调。 */
  let dirDialogTotal = 0;

  /** 一个内存 store：让「内联依赖」记下的句柄能被随后的保存读到（方案 A 的关键接线）。 */
  const mem = new Map();
  const store = {
    load: async (k) => mem.get(k) ?? null,
    save: async (k, v) => void mem.set(k, v),
  };

  /** omit 里的依赖从假目录里摘掉 ⇒ 复现「读不到」（真机上对应「文件不存在 / 没权限 / 不在所选目录内」）。 */
  const run = async (omit) => {
    const stash = {};
    for (const k of omit) {
      stash[k] = bytes[k];
      delete bytes[k];
    }
    const doc = new DOMParser().parseFromString(arg.source, 'text/html');
    const before = handed.length;
    const dialogsBefore = dirDialogTotal;
    const dirPicker = async () => {
      dirDialogTotal += 1;
      return root;
    };
    // 🔴 方案 A：先「内联依赖」弹一次只读框拿句柄记记忆，再「保存」用记忆句柄内联。
    //    保存路径本身**不弹框**（dirPicker 只在 inlineDepsForSave 里被调）。
    const inline = await EP.inlineDepsForSave(doc, arg.href, { dirPicker, store });
    const r = await EP.saveCopy(doc, arg.href, { dirPicker, store });
    for (const k of omit) bytes[k] = stash[k];
    const rec = handed.slice(before).find((x) => x.name !== null);
    return {
      outcome: r.outcome,
      detail: r.detail,
      fileName: r.fileName,
      /** 产品交给下载的文件名（应与 `fileName` 一致）。 */
      handedName: rec?.name ?? null,
      /** 交给下载的 Blob 的字节（读回文本）。 */
      html: rec ? await rec.blob.text() : null,
      /** 方案 A：目录框只在内联依赖动作里弹。第一次=1 次；之后保存 0 框。 */
      dirDialogs: dirDialogTotal - dialogsBefore,
      /** 内联依赖那次的 rememberedDir（方案 A 里它在 inlineDepsForSave 结果上）。 */
      inlineRemembered: inline.rememberedDir,
      inlineCancelled: inline.cancelled,
      memoryRejected: inline.memoryRejected || r.memoryRejected,
      hadScript: r.hadScript,
      inlined: r.inlined,
      failed: r.failedDeps,
      noDir: r.noDir,
      /** 🔴 第七轮：没能内联的引用被改写成绝对 URL（不再插兜底 `<base>`）。 */
      rebased: r.rebased,
    };
  };

  const happy = await run([]); // 依赖齐全
  const again = await run([]); // 再存一次 ⇒ 重名交给浏览器（探针不做序号避让）
  const degraded = await run(['assets/deep.png', 'extra/theme.css']); // 两个依赖读不到 ⇒ 走兜底
  return { happy, again, degraded };
};

// ── 页面侧量测 ──
const MEASURE = async () => {
  const url1 = (id) => {
    const bg = getComputedStyle(document.getElementById(id)).backgroundImage;
    const m = /url\(["']?(.*?)["']?\)/.exec(bg);
    return m ? m[1].slice(0, 24) : bg.slice(0, 24);
  };
  const txt = (id) => document.getElementById(id)?.textContent ?? '<无此元素>';
  // 🔴 判「图加载成功」用 `decode()`，**不用 `naturalWidth`**：
  //    `naturalWidth` 会按选中候选的密度折算（1×1 的 2x 候选 → 1/2 取整 = 0），
  //    拿它当判据会把「浏览器选了 2x 候选」误报成「加载失败」。
  //    尺寸只作为**补充信息**报出来，用来证「加载的是哪一张」。
  const pic = async (id) => {
    const el = document.getElementById(id);
    let loaded = 'ok';
    try {
      await el.decode();
    } catch (err) {
      loaded = `fail:${err.name}`;
    }
    return { loaded, nw: el.naturalWidth, nh: el.naturalHeight };
  };
  const dyn = await fetch('data.json')
    .then(async (r) => ({ ok: r.ok, status: r.status, body: (await r.text()).trim().slice(0, 24) }))
    .catch((e) => ({ err: String(e).split('\n')[0].slice(0, 90) }));
  return {
    href: location.href,
    baseURI: document.baseURI,
    hColor: getComputedStyle(document.getElementById('h')).color,
    importedColor: getComputedStyle(document.getElementById('imported')).color,
    tick: txt('tick'),
    pic: await pic('pic'),
    pic2: await pic('pic2'),
    set: await pic('set'),
    cssBg: url1('cssBg'),
    deepBg: url1('deepBg'),
    inlineBg: url1('inlineBg'),
    themeBg: url1('themeBg'),
    anchor: document.getElementById('anchor').href,
    dynamic: dyn,
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
// 全局错误收集器必须挂在第一个 goto **之前**，否则前面几步崩了也看不见。
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(`${page.url()} :: ${String(e).split('\n')[0]}`));

let out = {};
try {
  // ── 阶段 A：在原页面上跑产品变换 ──
  await page.goto(HREF);
  // 用 addScriptTag 而不是 evaluate(字符串)：后者把整段当表达式求值，`var` 声明能否落到
  // 全局取决于实现细节；插一个 `<script>` 是确定的行为。注入是否成功由下一条断言兜住。
  await page.addScriptTag({ content: BUNDLE });
  const A = await page.evaluate(RUN_PRODUCT, { files: FILES_BYTES, source: SOURCE, href: HREF });
  const bundleGlobal = await page.evaluate(() => {
    const EP = window.EPProbe;
    return { saveCopy: typeof EP?.saveCopy, dirReader: typeof EP?.dirReader };
  });
  const onOriginal = await page.evaluate(() => location.href);

  // 落盘三份产物：供阶段 B 用真浏览器验收
  ok(A.happy.html, `产品没产出副本：outcome=${A.happy.outcome} detail=${A.happy.detail}`);
  ok(A.degraded.html, `兜底场景没产出副本：outcome=${A.degraded.outcome}`);
  writeFileSync(join(ELSE, 'product-inlined.html'), A.happy.html, 'utf8');
  writeFileSync(join(ELSE, 'plain.html'), SOURCE, 'utf8'); // 反向确认：原样复制
  writeFileSync(join(ELSE_BASE, 'product-base-only.html'), A.degraded.html, 'utf8');

  const HTML = A.happy.html;
  const HTML_DEGRADED = A.degraded.html;
  const HTML2 = A.again.html;

  // ── 阶段 A 的断言（都在**产品的产物**上，而不是探针自造的字符串上）──
  check('产品代码被打包并注入成功（`EPProbe.saveCopy` 可用）', () => {
    ok(bundleGlobal.saveCopy === 'function', `saveCopy = ${bundleGlobal.saveCopy}`);
    return `saveCopy=${bundleGlobal.saveCopy} dirReader=${bundleGlobal.dirReader} · bundle ${Math.round(BUNDLE.length / 1024)}kB`;
  });
  check('变换跑在**原文件那个页面**上（`location.href` 就是原文件）', () => {
    // 🔴 盘符大小写是**环境相关量**（见 PROJ_DIR_URL 那行的说明）：`pathToFileURL` 保留
    //    cwd 的盘符大小写（bash 里常是小写 `c:`），浏览器统一规范成大写 `C:`。
    //    这个差异与被测行为无关 —— 上一轮能过只是恰好在 PowerShell 里启动（cwd 是大写），
    //    今天从 bash 启动就翻了车。凡比对 URL 的判据，一律大小写不敏感。
    ok(onOriginal.toLowerCase() === HREF.toLowerCase(), `location.href = ${onOriginal}`);
    return HREF.slice(-46);
  });
  check('🔴 顺利一份：`outcome=saved`、交给下载的名字是 `index_改.html`（原文件名 + `_改`）', () => {
    ok(A.happy.outcome === 'saved', `outcome = ${A.happy.outcome} / ${A.happy.detail}`);
    ok(A.happy.handedName === 'index_改.html', `交给下载的名字 = ${A.happy.handedName}`);
    ok(A.happy.fileName === A.happy.handedName, `fileName 与 handedName 不一致：${A.happy.fileName}`);
    return `${A.happy.fileName} · 已交给浏览器下载`;
  });
  check('🔴 方案 A：目录框只在「内联依赖」动作里弹一次；保存本身 0 框', () => {
    ok(A.happy.dirDialogs === 1, `目录框次数 = ${A.happy.dirDialogs}`);
    ok(A.happy.inlineRemembered === true, `inlineRemembered = ${A.happy.inlineRemembered}`);
    ok(A.happy.inlineCancelled === undefined, `inlineCancelled = ${A.happy.inlineCancelled}`);
    return '内联依赖弹 1 次只读框，保存不弹框';
  });
  check('🔴 保存路径**不弹框**（dirPicker 只在内联动作里被调；保存复跑 `again` 也 0 框）', () => {
    ok(A.happy.dirDialogs === 1, `happy 目录框 = ${A.happy.dirDialogs}（内联那次）`);
    ok(A.again.dirDialogs === 0, `again 目录框 = ${A.again.dirDialogs}（应 0：记忆已命中，保存不弹框）`);
    ok(A.happy.hadScript === true, `hadScript = ${A.happy.hadScript}`);
    return `happy=${A.happy.dirDialogs} 次 · again=${A.again.dirDialogs} 次 · hadScript=${A.happy.hadScript}`;
  });
  check('🔴 顺利一份**零失败依赖** ⇒ 这一份是自包含的（保存用记忆句柄内联）', () => {
    ok(A.happy.failed.length === 0, `失败清单：${JSON.stringify(A.happy.failed)}`);
    ok(A.happy.noDir === false, `noDir = ${A.happy.noDir}（有记忆句柄 ⇒ 自包含）`);
    return `内联 ${A.happy.inlined.length} 个：${A.happy.inlined.join('、')}`;
  });
  check('🔴 重名**交给浏览器**：两次交给下载的名字相同（不做我们自己的序号避让）', () => {
    // 用户裁决「文件名冲突交给 Chrome」：落点是下载文件夹，句柄探不到那里，
    // `nextFreeName` 既做不到也不需要 —— 重名由浏览器自动加 `(1)`（真落盘行为已由
    // `download-write-capability.mjs` 取证：连续两次不触发多文件确认）。
    ok(A.happy.fileName === 'index_改.html' && A.again.fileName === 'index_改.html',
      `两次文件名 = ${A.happy.fileName} / ${A.again.fileName}，期望相同`);
    ok(HTML2 === HTML, '两次内容应当一致（只是重名交由浏览器处理）');
    return `两次都是 ${A.happy.fileName}（落盘重名由浏览器加序号）`;
  });
  check('产物里**零静态外链残留**（没有 `styles.css` / `app.js` / `*.png` / `url(bg.png)`）', () => {
    // ⚠️ `@import` 的判据要写成 **css 语句的形状**，不能只搜词：夹具里那段可见文字
    //    「子目录 css 已展开」第一版就叫「@import 展开测试」，于是判据被自己的夹具点亮。
    const left = [
      [/href="styles\.css"/, 'href="styles.css"'],
      [/@import\s+(?:url\()?["']/i, '@import 语句'],
      [/src="app\.js"/, 'src="app.js"'],
      [/src="fig1\.png"/, 'src="fig1.png"'],
      [/src="assets\/deep\.png"/, 'src="assets/deep.png"'],
      [/url\(["']?bg\.png/, 'url(bg.png)'],
      [/url\(["']?(?:\.\.\/)?fig1\.png/, 'url(fig1.png)'],
    ]
      .filter(([re]) => re.test(HTML))
      .map(([, s]) => s);
    ok(!left.length, `仍残留：${left.join('、')}`);
    return `产物 ${HTML.length} 字节（原 ${SOURCE_BYTES.length}）`;
  });
  check('🔴 产物里**没有编辑器残留**（不加 `data-ep-*`、也不留 `data-inlined-from` 这类溯源标记）', () => {
    const hit = [/data-ep-[a-z]/i, /data-inlined-from/i, /contenteditable/i]
      .filter((re) => re.test(HTML))
      .map((re) => String(re));
    ok(!hit.length, `出现残留标记：${hit.join('、')}`);
    return '无 data-ep-* / contenteditable / 溯源属性';
  });
  check('🔴 `defer` 脚本被挪到 `</body>` 前（位置断言；运行断言在阶段 B）', () => {
    const iMark = HTML.indexOf('文本标记-DEFER');
    const iTick = HTML.indexOf('id="tick"');
    ok(iMark > 0, '产物里找不到脚本正文');
    ok(iTick > 0, '产物里找不到 #tick');
    ok(iMark > iTick, `脚本位置 ${iMark} 仍在 #tick（${iTick}）之前 ⇒ defer 语义没被保住`);
    return `脚本 ${iMark} > #tick ${iTick}`;
  });
  check('`srcset` 里的两个候选都换成 `data:`（描述符没被吃掉）', () => {
    const m = /srcset="([^"]*)"/i.exec(HTML);
    ok(m, '产物里找不到 srcset');
    const v = m[1];
    // ⚠️ 不能按逗号切来数候选：`data:image/png;base64,` **自己就带一个逗号**，
    //    切开是 4 段而不是 2 段。判据改成「还剩没剩文件引用」+「有几个 data: 候选」。
    ok(!/\.png/i.test(v), `srcset 里仍有文件引用：${v.slice(0, 90)}`);
    const hits = v.match(/data:image\/png;base64,/g) ?? [];
    ok(hits.length === 2, `data: 候选数 = ${hits.length}，期望 2`);
    ok(/ 1x, /.test(v) && / 2x$/.test(v.trim()), `descriptor 丢了：…${v.slice(-16)}`);
    return '2/2 候选均为 data:，描述符 1x/2x 保留';
  });

  // ── 阶段 B：拉出去（只剩一份 html）还活不活 ──
  const VIEW = {};
  for (const [label, file] of [
    ['原位 proj/index.html', join(PROJ, 'index.html')],
    ['拉出去 elsewhere/product-inlined.html', join(ELSE, 'product-inlined.html')],
    ['拉出去 elsewhere/plain.html（反向确认）', join(ELSE, 'plain.html')],
    ['兜底 elsewhere-base/product-base-only.html', join(ELSE_BASE, 'product-base-only.html')],
  ]) {
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(250);
    VIEW[label] = await page.evaluate(MEASURE);
  }
  const IN = VIEW['拉出去 elsewhere/product-inlined.html'];
  const PLAIN = VIEW['拉出去 elsewhere/plain.html（反向确认）'];
    /** 兜底场景副本（第七轮起靠「绝对 URL 改写」而非 base；目录名沿用第六轮）。 */
  const REBASED = VIEW['兜底 elsewhere-base/product-base-only.html'];
  const ORIG = VIEW['原位 proj/index.html'];
  const size = (p) => `${p.nw}×${p.nh}`;

  check('`elsewhere/` 里**只有 html**、没有任何依赖文件 ⇒ 真·单文件', () => {
    const names = readdirSync(ELSE);
    const extra = names.filter((f) => !/\.html$/.test(f));
    ok(!extra.length, `出现了额外文件：${extra.join('、')}`);
    return names.join(' · ');
  });
  check('🔴 拉出去后 css 仍生效（`styles.css` 的 `#h{color}` 起作用）', () => {
    ok(IN.hColor === 'rgb(22, 93, 255)', `hColor = ${IN.hColor}`);
    return IN.hColor;
  });
  check('🔴 拉出去后 `@import` 展开的规则也生效（子目录 css 被递归内联）', () => {
    ok(IN.importedColor === 'rgb(1, 2, 3)', `importedColor = ${IN.importedColor}`);
    return IN.importedColor;
  });
  check('🔴 拉出去后 js 仍执行，且 `defer` 的时序被保住（脚本找到了 `#tick`）', () => {
    ok(
      IN.tick.includes('脚本已跑起来'),
      `tick = ${IN.tick}（若产品没把 defer 脚本挪到 body 末尾，这里会抛错且文字不变）`,
    );
    return IN.tick;
  });
  check('🔴 拉出去后三张图都解码成功（根图 3×5 + **子目录**图 7×11 + `srcset` 命中图）', () => {
    ok(IN.pic.loaded === 'ok', `#pic ${IN.pic.loaded}`);
    ok(IN.pic2.loaded === 'ok', `#pic2(assets/deep.png) ${IN.pic2.loaded}`);
    ok(IN.set.loaded === 'ok', `#set(srcset) ${IN.set.loaded}`);
    ok(IN.pic.nw === 3 && IN.pic.nh === 5, `#pic 尺寸 = ${size(IN.pic)}，期望 3×5`);
    ok(IN.pic2.nw === 7 && IN.pic2.nh === 11, `#pic2 尺寸 = ${size(IN.pic2)}，期望 7×11`);
    return `pic=${size(IN.pic)} pic2=${size(IN.pic2)} set=${size(IN.set)}（srcset 命中 1x 或 2x，尺寸随之折算，故只断言解码成功）`;
  });
  check('🔴 四处 `url()` 全成 `data:`（css 文件内 / 子目录 css 内 / 页内 `<style>` 内）', () => {
    const bad = [
      ['cssBg ← styles.css', IN.cssBg],
      ['deepBg ← styles.css(子目录图)', IN.deepBg],
      ['inlineBg ← 页内 <style>', IN.inlineBg],
      ['themeBg ← extra/theme.css 的 ../', IN.themeBg],
    ].filter(([, v]) => !v.startsWith('data:'));
    ok(!bad.length, bad.map(([n, v]) => `${n} = ${v}`).join('；'));
    return '4/4 均为 data:';
  });
  check('🔴 该页面**无脚本异常**（`defer` 挪位若做错，这里会留下 TypeError）', () => {
    const mine = pageErrors.filter((e) => e.includes('elsewhere/product-inlined.html'));
    ok(!mine.length, mine.join(' | '));
    return `该页 0 条；全部记录 ${pageErrors.length} 条`;
  });
  check('🔴 内联副本里 `#top` 解析到**它自己**（对比 base 方案会跳去目录页）', () => {
    ok(/\/elsewhere\/product-inlined\.html#top$/.test(IN.anchor), `anchor.href = ${IN.anchor}`);
    return IN.anchor.slice(-42);
  });

  // ── 反向确认 ──
  check('🔴 反向确认：只把 html 原样复制过去 ⇒ css / js / 图**三样全坏**（否则内联不是起作用的那个因）', () => {
    const bad = [];
    if (PLAIN.hColor === 'rgb(22, 93, 255)') bad.push('css 竟然生效了');
    if (PLAIN.tick.includes('脚本已跑起来')) bad.push('js 竟然执行了');
    if (PLAIN.pic.loaded === 'ok') bad.push('图片竟然解码了');
    if (PLAIN.set.loaded === 'ok') bad.push('srcset 图竟然解码了');
    ok(!bad.length, bad.join('、'));
    return `hColor=${PLAIN.hColor} tick=${PLAIN.tick} pic=${PLAIN.pic.loaded} set=${PLAIN.set.loaded}`;
  });

  // ── 兜底场景（第七轮用户裁决：读不到就把**那一条引用**改写成绝对 URL，不插 base）──
  check('🔴 读不到依赖时：失败清单如实登记（不静默产出一份「看着自包含、其实是坏的」）', () => {
    const paths = A.degraded.failed.map((f) => f.path).sort();
    ok(A.degraded.failed.length === 2, `失败 ${A.degraded.failed.length} 条：${JSON.stringify(A.degraded.failed)}`);
    ok(paths.join('、') === 'assets/deep.png、extra/theme.css', `失败清单 = ${paths.join('、')}`);
    return paths.join('、');
  });
  check('🔴 读不到 ⇒ 那条引用改写成**指向原目录的绝对 URL**，且**不插** `<base>`', () => {
    ok(A.degraded.rebased.length === 2, `rebased = ${JSON.stringify(A.degraded.rebased)}`);
    ok(
      A.degraded.rebased.every((u) => u.toLowerCase().startsWith(PROJ_DIR_URL.toLowerCase())),
      `改写出来的不是原目录的绝对 URL：${JSON.stringify(A.degraded.rebased)}`,
    );
    // 🔴 不插 base：旧版那个 base 会把页面上所有 `href="#…"` 一并解析到原目录 ——
    //    用户点一下导航就跳出副本，随后 Chrome 把导航判成跨 file 源而全拦（原话「没法点」）。
    ok(!/<base/i.test(HTML_DEGRADED), '竟然又插了 `<base>` —— 第七轮已把这个兜底整个摘掉');
    return A.degraded.rebased.map((u) => u.slice(-30)).join('、');
  });
  check('🔴 兜底副本的 `document.baseURI` 是**它自己**（没被 base 拉回原目录）', () => {
    ok(
      !REBASED.baseURI.toLowerCase().startsWith(PROJ_DIR_URL.toLowerCase()),
      `baseURI 又被拉回原目录了：${REBASED.baseURI}`,
    );
    return `baseURI = ${REBASED.baseURI.slice(-44)}（它自己在 elsewhere-base/）`;
  });
  check('🔴 兜底副本**能用**：内联进来的部分照常，没内联的那两个依赖靠绝对 URL 从原目录取到', () => {
    ok(REBASED.hColor === 'rgb(22, 93, 255)', `hColor = ${REBASED.hColor}`);
    ok(REBASED.importedColor === 'rgb(1, 2, 3)', `@import 回原目录取 → importedColor = ${REBASED.importedColor}`);
    ok(REBASED.pic2.loaded === 'ok', `assets/deep.png 回原目录取 → ${REBASED.pic2.loaded}`);
    ok(REBASED.tick.includes('脚本已跑起来'), `tick = ${REBASED.tick}`);
    return `css/js/图都活；deep.png=${size(REBASED.pic2)}`;
  });
  check('🔴 页内锚点**仍指向副本自己** —— 这正是用户报的「没法点」的回归锁', () => {
    ok(/product-base-only\.html#top$/.test(REBASED.anchor), `锚点没指向自己：${REBASED.anchor}`);
    return `anchor → ${REBASED.anchor.slice(-34)}`;
  });

  // ── 诚实边界 ──
  check("⚠️ 边界①：拉出去后运行时 `fetch('data.json')` **仍然不可用**（静态内联治不了动态请求）", () => {
    ok(!IN.dynamic.ok, `竟然成功了：${JSON.stringify(IN.dynamic)}`);
    return IN.dynamic.err ? `失败（${IN.dynamic.err.slice(0, 56)}…）` : JSON.stringify(IN.dynamic);
  });
  check('⚠️ 边界②：**原位也一样不可用** ⇒ 这不是「搬走造成的」，是 `file://` 页面本身就禁止 fetch 本地文件', () => {
    ok(!ORIG.dynamic.ok, `原位竟然成功了：${JSON.stringify(ORIG.dynamic)}`);
    return ORIG.dynamic.err ? `原位同样失败（${ORIG.dynamic.err.slice(0, 56)}…）` : JSON.stringify(ORIG.dynamic);
  });

  out = { href: HREF, projDirUrl: PROJ_DIR_URL, product: A, views: VIEW, pageErrors };
} catch (err) {
  // 硬失败（产品管线中途抛异常）也要落进断言表 —— 否则报告里只剩一句异常，
  // 看着像「探针自己坏了」，而它其实是**产品或夹具**的失败信号。
  check('探针完整跑完产品管线（未中途抛异常）', () => {
    throw new Error(String(err).split('\n')[0]);
  });
  out.error = String(err);
} finally {
  await ctx.close();
  await browser.close();
}

writeFileSync(join(OUT_DIR, 'selfcontain-capability.json'), JSON.stringify(out, null, 2), 'utf8');

console.log('\n══════════ 「自包含」另存能力探针（产品变换版）══════════');
console.log(`原目录    ：${PROJ_DIR_URL}`);
console.log(`拉出去到  ：${pathToFileURL(ELSE).href}`);
console.log(`兜底副本到：${pathToFileURL(ELSE_BASE).href}\n`);
const brief = (p) => `${p.loaded}${p.loaded === 'ok' ? `(${p.nw}×${p.nh})` : ''}`;
for (const [label, r] of Object.entries(out.views ?? {})) {
  console.log(`── ${label} ──`);
  console.log(`  baseURI        : ${r.baseURI.slice(-46)}`);
  console.log(`  css/imported   : ${r.hColor} / ${r.importedColor}`);
  console.log(`  js  (tick)     : ${r.tick}`);
  console.log(`  图 pic/pic2/set: ${brief(r.pic)} | ${brief(r.pic2)} | ${brief(r.set)}`);
  console.log(
    `  url() 4 处     : ${[r.cssBg, r.deepBg, r.inlineBg, r.themeBg].map((v) => (v.startsWith('data:') ? 'data:' : v)).join(' | ')}`,
  );
  console.log(
    `  fetch(data.json): ${r.dynamic.ok ? `OK ${r.dynamic.status} ${r.dynamic.body}` : `✗ ${r.dynamic.err?.slice(0, 64)}`}`,
  );
}
if (out.pageErrors?.length) console.log(`\n页面错误：${out.pageErrors.slice(0, 3).join(' | ')}`);

console.log('\n── 断言明细 ──');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.detail}`);
const pass = results.filter((r) => r.ok).length;
console.log(`\n共 ${results.length} 项，通过 ${pass}，失败 ${results.length - pass}`);
console.log('⚠️ 仍不在能力范围内（如实标注，不假装已覆盖）：');
console.log('   · `dirReader` 能否用**真**目录句柄读到字节 —— 要有真句柄，属人手门禁 G1');
console.log('   · 下载管线的最后一程（下载气泡 UI、真正落盘到下载文件夹、重名自动 `(1)`）——');
console.log('     其中「可下载 / 中文名逐字符尊重 / 字节一致 / 连续两次不触发多文件确认」四项');
console.log('     已由 `download-write-capability.mjs` 在真浏览器取证 4/4；残余 G1 = 真人眼看气泡。');
console.log('   · 「目录框打开时就停在原目录」（`startIn`）—— OS 级窗口行为，同属 G1。');
console.log('   · 运行时 fetch/XHR 依赖（静态内联原理上做不到） · `<iframe src>` 不内联');
console.log(`JSON → ${join(OUT_DIR, 'selfcontain-capability.json')}\n`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
