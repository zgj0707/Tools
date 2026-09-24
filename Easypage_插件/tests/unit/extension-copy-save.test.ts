// @vitest-environment happy-dom
// P0-9：另存一份 `原名_改.html` 副本。**2026-09-23 深夜（方案 A）：保存与内联拆成两步**。
//
//   · **保存（下载）永远 0 框**：只用记忆里的句柄内联（有则自包含；读不到就把那条引用
//     **改写成绝对 URL** —— 第七轮用户裁决，不再插兜底 `<base>`），
//     下载断言 = 捕获 `URL.createObjectURL` 的 Blob + `<a download>` 文件名（读回字节比对）；
//   · **内联依赖（独立动作）**：`inlineDepsForSave` 是**唯一**会弹原生目录框的入口，
//     弹框拿句柄记记忆，之后保存自动自包含。
//
// 🔴 「保存 0 框」的最强证据：`saveCopy` 的路径里**没有**任何 `dirPicker` 调用 ——
//    dirPicker 只在 `inlineDepsForSave` 里被调。断言「保存时 dirPicker 调用 0 次」即可。
//
// ⚠️ 测不到的（必须写明，否则会被当成「全验过了」）：
//   ① **真实下载气泡与真实落盘** —— 浏览器 UI，happy-dom 量不到 ⇒ 由
//      `qa/probes/download-write-capability.mjs`（4/4）与人手门禁 G1 承担；
//   ② **真实目录句柄**下的读 —— 要真人点只读目录框才拿得到句柄 ⇒ G1；
//   ③ 「内联后的单文件拷到别处仍能用」的端到端结论 —— 由 `qa/probes/selfcontain-capability.mjs`
//      在真浏览器里量过（含反向确认）；
//   ④ **重名自动加 `(1)`** —— 浏览器行为，探针已证「连续两次不触发多文件确认」。
//   本文件里的句柄、目录框、store 全是假的。

import { beforeEach, describe, expect, it } from 'vitest';
import {
  copyNameOf,
  dirKeyOf,
  dirReader,
  dirScopeKeyOf,
  inlineDepsForSave,
  looksLikeDirHandle,
  RECENT_DIR_KEY,
  saveCopy,
  type DirHandleLike,
  type DirPicker,
} from '../../src/extension/copy-save';
import { pathKeyOf, type HandleStore } from '../../src/extension/handle-store';

const HREF = 'file:///C:/proj/index.html';
const PAGE = `<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1 id="h">t</h1><p><script src="app.js"></script></p></body></html>`;
const DEPS = { 'styles.css': '#h{color:red}', 'app.js': 'window.__ran=1;' };

const docOf = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
const enc = (s: string) => new TextEncoder().encode(s);

// ── 下载捕获 ──────────────────────────────────────────────────────────────

const downloads: Array<{ name: string; url: string }> = [];
const blobByUrl = new Map<string, Blob>();

beforeEach(() => {
  downloads.length = 0;
  blobByUrl.clear();
  URL.createObjectURL = ((b: Blob) => {
    const url = 'blob:mock';
    blobByUrl.set(url, b);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, url: this.getAttribute('href') ?? '' });
  };
});

/** 读回某次下载的字节（按文本）。 */
async function bodyOf(i: number): Promise<string> {
  const d = downloads[i];
  if (!d) return '';
  return await (blobByUrl.get(d.url) ?? new Blob()).text();
}

// ── 内存文件系统 + 目录句柄 ─────────────────────────────────────────────────

function fakeFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial).map(([k, v]) => [k, enc(v)]));

  const dirAt = (prefix: string): DirHandleLike => ({
    name: prefix ? (prefix.split('/').pop() ?? prefix) : 'proj',
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
    getDirectoryHandle: async (n: string, o?: { create?: boolean }) => {
      const p = prefix ? `${prefix}/${n}` : n;
      const exists = [...files.keys()].some((k) => k.startsWith(`${p}/`));
      if (!exists && !o?.create) {
        const e = new Error('not found');
        e.name = 'NotFoundError';
        throw e;
      }
      return dirAt(p);
    },
    getFileHandle: async (n: string, o?: { create?: boolean }) => {
      const p = prefix ? `${prefix}/${n}` : n;
      if (!files.has(p) && !o?.create) {
        const e = new Error('not found');
        e.name = 'NotFoundError';
        throw e;
      }
      return {
        name: n,
        queryPermission: async () => 'granted' as PermissionState,
        requestPermission: async () => 'granted' as PermissionState,
        getFile: async () => ({
          arrayBuffer: async () => (files.get(p) ?? new Uint8Array()).slice().buffer as ArrayBuffer,
        }),
      };
    },
  });

  return { root: dirAt('') };
}

/**
 * 目录选择器**收到的选项**。
 *
 * 取 `Parameters<DirPicker>[0]` 而不是手抄一遍：`startIn` 是这条链路上**唯一**能被断言的
 * 「框开在哪」的部分（「框真的停在那儿」是 OS 级行为 ⇒ 只进得了人手门禁 G1）。
 */
type DirPickerOpts = NonNullable<Parameters<DirPicker>[0]>;

/**
 * 假的目录选择器：记录调用次数与**收到的选项**，返回给定目录。
 *
 * 🔴 方案 A 下它**只在** `inlineDepsForSave` 里被调。断言「保存时调用 0 次」= 保存 0 框。
 */
function fakeDirPicker(
  root: DirHandleLike,
  calls: { n: number },
  fail?: string,
  rec?: DirPickerOpts[],
): DirPicker {
  return async (opts) => {
    calls.n += 1;
    if (opts) rec?.push(opts);
    if (fail) {
      const e = new Error('nope');
      e.name = fail;
      throw e;
    }
    return root;
  };
}

/** 假 store：只存一个键，够用来验「记忆命中 / 成功后才记」。 */
function fakeStore(initial: unknown = null) {
  const saved: Array<{ key: string; value: unknown }> = [];
  const store: HandleStore = {
    load: async () => initial,
    save: async (k, v) => void saved.push({ key: k, value: v }),
  };
  return { store, saved };
}

/**
 * **按 key 走**的内存 store。
 *
 * 为什么 `fakeStore`（load 恒返回 `initial`）在这里不够用：目录记忆是**两级**的
 * （目录级优先、文档级兜底），要验「哪一级命中 / 哪一级被写」就必须让 load 认得 key。
 */
function keyedStore(entries: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(entries));
  const store: HandleStore = {
    load: async (k) => map.get(k) ?? null,
    save: async (k, v) => void map.set(k, v),
  };
  return { store, map };
}

// ── 纯函数 ────────────────────────────────────────────────────────────────

describe('copyNameOf / dirKeyOf / looksLikeDirHandle', () => {
  it('copyNameOf：只切**最后一个**点；🔴 不做序号避让（交给浏览器加 `(1)`）', () => {
    expect(copyNameOf('index.html')).toBe('index_改.html');
    expect(copyNameOf('index.htm')).toBe('index_改.htm');
    expect(copyNameOf('a.b.html')).toBe('a.b_改.html');
    expect(copyNameOf('readme')).toBe('readme_改');
    expect(copyNameOf('.hidden')).toBe('.hidden_改');
    expect((copyNameOf as (b: string) => string).length).toBe(1);
  });

  it('dirKeyOf 带 `dir:` 前缀 —— 与 P0-7 的文件句柄分开命名空间', () => {
    expect(dirKeyOf(HREF)).toBe(`dir:${pathKeyOf(HREF)}`);
    expect(dirKeyOf(HREF).startsWith('dir:')).toBe(true);
  });

  it('🔴 dirScopeKeyOf 落到**所在目录** —— 同目录的不同文件必须得到同一个键', () => {
    expect(dirScopeKeyOf('file:///C:/proj/a.html')).toBe('dir:file:///C:/proj/');
    expect(dirScopeKeyOf('file:///C:/proj/b.html')).toBe(dirScopeKeyOf('file:///C:/proj/a.html'));
    expect(dirScopeKeyOf(HREF).endsWith('/')).toBe(true);
    expect(dirScopeKeyOf(HREF)).not.toBe(dirKeyOf(HREF));
    expect(dirScopeKeyOf('file:///C:/proj/a.html?v=2#x')).toBe('dir:file:///C:/proj/');
  });

  it('looksLikeDirHandle：文件句柄不认、只有 getFileHandle 的也不认', () => {
    expect(looksLikeDirHandle(null)).toBe(false);
    expect(looksLikeDirHandle({ name: 'x', createWritable: async () => ({}) })).toBe(false);
    expect(looksLikeDirHandle({ name: 'x', getFileHandle: async () => ({}) })).toBe(false);
    const { root } = fakeFs({});
    expect(looksLikeDirHandle(root)).toBe(true);
  });
});

describe('dirReader · 只读该目录的下层', () => {
  it('能读根文件与子目录文件', async () => {
    const { root } = fakeFs({ 'a.css': 'A', 'assets/b.png': 'B' });
    const read = dirReader(root);
    expect(new TextDecoder().decode((await read('a.css')) ?? new Uint8Array())).toBe('A');
    expect(new TextDecoder().decode((await read('assets/b.png')) ?? new Uint8Array())).toBe('B');
  });

  it('🔴 `..` 一律拒绝 —— 目录句柄读不到上层，越级必须失败而不是猜', async () => {
    const { root } = fakeFs({ 'a.css': 'A' });
    expect(await dirReader(root)('../shared/x.css')).toBeNull();
  });

  it('不存在的文件返回 null（不抛）', async () => {
    const { root } = fakeFs({});
    expect(await dirReader(root)('nope.css')).toBeNull();
  });
});

// ── 保存路径（方案 A：永远 0 框）──────────────────────────────────────────

describe('saveCopy · 保存永远 0 框（方案 A）', () => {
  it('🔴 记忆里没有句柄 ⇒ **不弹框**，直接下载，依赖改写成绝对 URL（副本不自包含）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const dirCalls = { n: 0 };
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, dirCalls),
      store: fakeStore().store,
    });
    // 🔴 方案 A 的核心：保存路径**一次目录框都不弹**
    expect(dirCalls.n).toBe(0);
    expect(r.outcome).toBe('saved');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe('index_改.html');
    expect(r.noDir).toBe(true); // 没句柄 ⇒ 读不到字节
    expect(r.failedDeps).toHaveLength(2);
    // 🔴 第七轮：不插兜底 base，改为把读不到的引用改写成绝对 URL。
    //    旧版那个 base 会把页面上所有 `href="#…"` 锚点一并拉去原目录 ⇒ 点导航就跳出副本。
    const html = await bodyOf(0);
    expect(html).not.toContain('<base');
    expect(html).toContain('href="file:///C:/proj/styles.css"');
    expect(r.rebased).toEqual(['file:///C:/proj/styles.css', 'file:///C:/proj/app.js']);
  });

  it('🔴 记忆里有句柄 ⇒ 不弹框，且副本自包含（依赖内联）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const dirCalls = { n: 0 };
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, dirCalls),
      store: fakeStore(root).store, // 记忆里有句柄
    });
    expect(dirCalls.n).toBe(0); // 记忆命中 ⇒ 0 框
    expect(r.outcome).toBe('saved');
    expect(r.noDir).toBe(false);
    expect(r.rebased).toEqual([]); // 全部内联成功 ⇒ 没有任何引用需要改写
    expect(r.failedDeps).toEqual([]);
    const html = await bodyOf(0);
    expect(html).toContain('#h{color:red}');
    expect(html).not.toContain('href="styles.css"');
  });

  it('🔴 记忆里是**信封** `{h, ok}` ⇒ 解包命中，0 框且自包含', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const dirCalls = { n: 0 };
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, dirCalls),
      store: fakeStore({ h: root, ok: true }).store,
    });
    expect(dirCalls.n).toBe(0);
    expect(r.outcome).toBe('saved');
    expect(r.noDir).toBe(false);
  });

  it('🔴 记忆里是**文件**句柄（旧脏值）⇒ 当作没有，0 框、不自包含', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const dirCalls = { n: 0 };
    const fileLike = { name: 'index.html', createWritable: async () => ({}) };
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, dirCalls),
      store: fakeStore(fileLike).store,
    });
    expect(dirCalls.n).toBe(0);
    expect(r.outcome).toBe('saved');
    expect(r.noDir).toBe(true);
  });

  it('🔴 记忆被自愈否决（目录里没有当前文件）⇒ 保存**不弹框重指认**，只如实标注不自包含', async () => {
    const wrong = fakeFs({ 'other.html': PAGE }).root; // 记忆里存的错目录：没有 index.html
    const dirCalls = { n: 0 };
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(wrong, dirCalls),
      store: fakeStore(wrong).store,
    });
    expect(dirCalls.n).toBe(0); // 🔴 方案 A：保存路径不弹框重指认
    expect(r.outcome).toBe('saved');
    expect(r.noDir).toBe(true);
    // 被否决 ⇒ 拿不到句柄 ⇒ 两条依赖都改写成绝对 URL 兜底（阅读依赖走不了记忆那条路）
    expect(r.rebased).toEqual(['file:///C:/proj/styles.css', 'file:///C:/proj/app.js']);
  });

  it('🔴 交给下载的内容里零 `ep-` 痕迹（否则会把编辑器垃圾交给用户）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore(root).store,
    });
    const html = await bodyOf(0);
    expect(html).not.toContain('data-ep-');
    expect(html).not.toContain('ep-');
  });

  it('🔴 下载触发改写失败 ⇒ failed，如实上报且不假装成功', async () => {
    URL.createObjectURL = (() => {
      const e = new Error('boom');
      e.name = 'QuotaExceededError';
      throw e;
    }) as unknown as typeof URL.createObjectURL;
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore(root).store,
    });
    expect(r.outcome).toBe('failed');
    expect(r.detail).toBe('QuotaExceededError');
    expect(downloads).toHaveLength(0);
  });
});

describe('saveCopy · 依赖读不到时改写成绝对 URL（第七轮用户裁决）', () => {
  it('🔴 有读不到的依赖 ⇒ 引用改写成绝对 URL、**不插 base**，并标记「不自包含」', async () => {
    const { root } = fakeFs({ 'index.html': PAGE }); // styles.css / app.js 都不存在
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore(root).store,
    });
    const html = await bodyOf(0);
    // 🔴 不插 base：旧版那个 base 会把页面上所有 `href="#…"` 页内锚点一并解析到原目录，
    //    用户点一下导航就跳出副本，随后 Chrome 把导航判成跨 file 源而全拦（「没法点」）。
    expect(html).not.toContain('<base');
    expect(html).toContain('href="file:///C:/proj/styles.css"');
    expect(html).toContain('src="file:///C:/proj/app.js"');
    expect(r.failedDeps).toHaveLength(2);
    expect(r.rebased).toEqual(['file:///C:/proj/styles.css', 'file:///C:/proj/app.js']);
  });

  it('全部依赖都读到 ⇒ 一个引用都不改写（副本真的自包含）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const r = await saveCopy(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore(root).store,
    });
    expect(r.rebased).toEqual([]);
    // 反向确认：同一份 html 在没有依赖缺失时**不该**出现原目录的绝对路径
    expect(await bodyOf(0)).not.toContain('file:///C:/proj/');
  });

  it('🔴 页内 `#锚点` 原样保留（用户报的「没法点」的回归锁）', async () => {
    const html = `<!DOCTYPE html><html><head><link rel="stylesheet" href="s.css"></head><body><a href="#top">a</a></body></html>`;
    const { root } = fakeFs({ 'index.html': html }); // s.css 读不到 ⇒ 走改写
    const r = await saveCopy(docOf(html), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore(root).store,
    });
    const out = await bodyOf(0);
    expect(r.rebased).toEqual(['file:///C:/proj/s.css']);
    expect(out).not.toContain('<base');
    // 锚点必须留在原样：一旦被解析到别处，副本的导航就不再是「文档内跳转」
    expect(out).toContain('href="#top"');
    // 同一条断言的反向确认：改写确实发生了（否则上面那条「保留锚点」可能只是什么都没做）
    expect(out).toContain('href="file:///C:/proj/s.css"');
  });

  it('页面自带 `<base href="assets/">` ⇒ 不覆盖它；改写按**页面自己的 base** 解析', async () => {
    const html = `<!DOCTYPE html><html><head><base href="assets/"><link rel="stylesheet" href="s.css"></head><body>x</body></html>`;
    const { root } = fakeFs({ 'index.html': html }); // s.css 读不到
    const r = await saveCopy(docOf(html), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore(root).store,
    });
    const out = await bodyOf(0);
    expect(r.rebased).toEqual(['file:///C:/proj/assets/s.css']);
    expect((out.match(/<base/g) ?? []).length).toBe(1); // 只有页面自己那一个，我们不加
  });
});

// ── 内联依赖动作（方案 A：唯一会弹原生目录框的入口）────────────────────────

describe('inlineDepsForSave · 唯一会弹目录框的入口', () => {
  it('🔴 记忆里没有句柄 ⇒ 弹**一次**只读目录框，拿到句柄记记忆，并当场内联验证', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const dirCalls = { n: 0 };
    const rec: DirPickerOpts[] = [];
    const r = await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, dirCalls, undefined, rec),
      store: fakeStore().store,
    });
    expect(dirCalls.n).toBe(1);
    expect(rec[0]?.mode).toBe('read');
    expect(rec[0]?.id).toBe('ep-read-dir');
    expect(r.rememberedDir).toBe(true);
    expect(r.cancelled).toBeUndefined();
    expect(r.failedDeps).toEqual([]);
    expect(r.inlined).toEqual(['styles.css', 'app.js']);
  });

  it('🔴 记忆里已有句柄 ⇒ **不弹框**（用户重复点按钮也不该再问）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const dirCalls = { n: 0 };
    const r = await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, dirCalls),
      store: fakeStore(root).store,
    });
    expect(dirCalls.n).toBe(0);
    expect(r.rememberedDir).toBe(false);
  });

  it('🔴 拿到句柄后记两个键：目录级（裸句柄）+ 最近', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const { store, saved } = fakeStore();
    await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store,
    });
    expect(saved.map((s) => s.key)).toEqual([dirScopeKeyOf(HREF), RECENT_DIR_KEY]);
    expect(saved[0]?.value).toBe(root); // 裸句柄，不是信封
  });

  it('🔴 用户取消 ⇒ `cancelled`，不记记忆', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const { store, saved } = fakeStore();
    const r = await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }, 'AbortError'),
      store,
    });
    expect(r.cancelled).toBe(true);
    expect(saved).toEqual([]);
  });

  it('🔴 环境没有目录选择器 ⇒ `cancelled`（保存仍可用，只是不自包含）', async () => {
    const r = await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: null,
      store: fakeStore().store,
    });
    expect(r.cancelled).toBe(true);
  });

  it('🔴 记忆被自愈否决 ⇒ 弹只读框重指认，且**不传 startIn**（最近键多半就是被否决的目录）', async () => {
    const wrong = fakeFs({ 'other.html': PAGE }).root; // 记忆里存的错目录
    const right = fakeFs({ 'index.html': PAGE, ...DEPS }).root;
    const { store, map } = keyedStore({ [dirScopeKeyOf(HREF)]: wrong });
    const dirCalls = { n: 0 };
    const rec: DirPickerOpts[] = [];
    const r = await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(right, dirCalls, undefined, rec),
      store,
    });
    expect(dirCalls.n).toBe(1);
    expect(r.memoryRejected).toBe(true);
    expect(Object.hasOwn(rec[0] ?? {}, 'startIn')).toBe(false);
    expect(map.get(dirScopeKeyOf(HREF))).toBe(right); // 重选后记忆被改写成对的裸句柄
  });

  it('🔴 最近目录权限有效 ⇒ 传给 dirPicker（省掉一次手动导航）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const { store } = keyedStore({ [RECENT_DIR_KEY]: root });
    const rec: DirPickerOpts[] = [];
    await inlineDepsForSave(docOf(PAGE), 'file:///C:/other/index.html', {
      dirPicker: fakeDirPicker(root, { n: 0 }, undefined, rec),
      store,
    });
    expect(rec[0]?.startIn).toBe(root);
  });

  it('🔴 最近目录权限不是 granted ⇒ **连 `startIn` 这个键都不出现**', async () => {
    const { root } = fakeFs({ 'index.html': PAGE, ...DEPS });
    const stale: DirHandleLike = { ...root, queryPermission: async () => 'prompt' as PermissionState };
    const { store } = keyedStore({ [RECENT_DIR_KEY]: stale });
    const rec: DirPickerOpts[] = [];
    await inlineDepsForSave(docOf(PAGE), 'file:///C:/other/index.html', {
      dirPicker: fakeDirPicker(root, { n: 0 }, undefined, rec),
      store,
    });
    expect(Object.hasOwn(rec[0] ?? {}, 'startIn')).toBe(false);
  });

  it('🔴 内联后仍有失败依赖 ⇒ 如实报出（这份副本仍不自包含）', async () => {
    const { root } = fakeFs({ 'index.html': PAGE }); // 依赖都不存在
    const r = await inlineDepsForSave(docOf(PAGE), HREF, {
      dirPicker: fakeDirPicker(root, { n: 0 }),
      store: fakeStore().store,
    });
    expect(r.rememberedDir).toBe(true); // 目录还是记住了（读依赖的目录没错）
    expect(r.failedDeps).toHaveLength(2);
  });
});

