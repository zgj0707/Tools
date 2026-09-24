// @vitest-environment happy-dom
// P0-9：依赖内联 —— 让另存出来的副本**自包含**（能单独拉出去分享）。
//
// 这里用**假的 reader**（内存里的文件表）驱动真实变换逻辑，逐条钉住：
// 内联了什么、相对哪个文件解析、读不到时会怎样、哪些东西**不许动**。
//
// ⚠️ 测不到的：真目录句柄下的「读到字节」（`dir-save` 的 `dirReader`）与
// 「内联后的单文件拷到别处仍能用」的**端到端**结论 —— 前者要真人点目录框（人手门禁 G1），
// 后者由 `qa/probes/selfcontain-capability.mjs` 在真浏览器里量过（10/10）。

import { describe, expect, it } from 'vitest';
import {
  inlineDependencies,
  mimeOfPath,
  resolveDepPath,
  dirUrlOf,
} from '../../src/extension/inline-deps';

const HREF = 'file:///C:/proj/index.html';
const enc = (s: string) => new TextEncoder().encode(s);
const docOf = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const page = (head: string, body = '<p id="p">x</p>') =>
  `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

function readerOf(files: Record<string, string>) {
  const calls: string[] = [];
  const read = async (rel: string): Promise<Uint8Array | null> => {
    calls.push(rel);
    const body = files[rel];
    return body === undefined ? null : enc(body);
  };
  return { read, calls };
}

async function run(html: string, files: Record<string, string>) {
  const copy = docOf(html);
  const { read, calls } = readerOf(files);
  const out = await inlineDependencies(copy, { href: HREF, read });
  return { copy, result: out, html: copy.documentElement.outerHTML, calls };
}

describe('copyNameOf / mimeOfPath / dirUrlOf / resolveDepPath 这些纯函数', () => {
  it('mimeOfPath 按扩展名给 mime，未知的一律 octet-stream', () => {
    expect(mimeOfPath('a.css')).toBe('text/css');
    expect(mimeOfPath('a.js')).toBe('text/javascript');
    expect(mimeOfPath('a.png')).toBe('image/png');
    expect(mimeOfPath('a.woff2')).toBe('font/woff2');
    expect(mimeOfPath('a.unknownext')).toBe('application/octet-stream');
  });

  it('dirUrlOf 给出文档所在目录（带尾斜杠）', () => {
    expect(dirUrlOf(HREF)).toBe('file:///C:/proj/');
  });

  it('resolveDepPath：解析成文档相对路径', () => {
    expect(resolveDepPath('styles.css', HREF, dirUrlOf(HREF))).toEqual({
      kind: 'dep',
      rel: 'styles.css',
    });
    // 子目录
    expect(resolveDepPath('css/a.css', HREF, dirUrlOf(HREF))).toEqual({
      kind: 'dep',
      rel: 'css/a.css',
    });
    // 带查询串/锚点：只取路径部分
    expect(resolveDepPath('a.css?v=2#x', HREF, dirUrlOf(HREF))).toEqual({
      kind: 'dep',
      rel: 'a.css',
    });
    // 百分号编码要解码（用户文件名里有中文/空格）
    expect(resolveDepPath('my%20style.css', HREF, dirUrlOf(HREF))).toEqual({
      kind: 'dep',
      rel: 'my style.css',
    });
  });

  it('resolveDepPath：越界（`../` 爬到上一层）单独成一类（读不到，但**能**改写成绝对 URL）', () => {
    const r = resolveDepPath('../shared/x.css', HREF, dirUrlOf(HREF));
    expect(r.kind).toBe('outside');
  });

  it('resolveDepPath：不该动的三种一律 skip（data: / http(s): / 锚点）', () => {
    for (const raw of ['data:image/png;base64,AAA', 'https://cdn.x/a.css', '#top', '']) {
      expect(resolveDepPath(raw, HREF, dirUrlOf(HREF)).kind).toBe('skip');
    }
  });
});

describe('inlineDependencies · 各类依赖的内联', () => {
  it('<link rel=stylesheet> → <style>，且 css 里的 url() 也换成 data:', async () => {
    const { html, result } = await run(
      page('<link rel="stylesheet" href="styles.css">'),
      {
        'styles.css': '#h{color:red}\n#bg{background:url(bg.png)}',
        'bg.png': 'PNG-BYTES',
      },
    );
    expect(html).not.toContain('href="styles.css"');
    expect(html).toContain('<style>');
    expect(html).toContain('#h{color:red}');
    // 🔴 url() 必须指成 data:，否则副本搬走后背景图会指回旧目录
    expect(html).toContain('url("data:image/png;base64,');
    expect(html).not.toContain('url(bg.png)');
    expect(result.inlined).toEqual(['styles.css', 'bg.png']);
    expect(result.failures).toEqual([]);
  });

  it('css 里的 url() 相对**那个 css 文件**解析，不是相对文档', async () => {
    const { html, result } = await run(page('<link rel="stylesheet" href="css/a.css">'), {
      'css/a.css': '#x{background:url(bg.png)}',
      'css/bg.png': 'NEAR-CSS',
    });
    expect(result.failures).toEqual([]);
    expect(result.inlined).toContain('css/bg.png');
    expect(html).toContain('data:image/png;base64,');
  });

  it('@import 递归展开，并把媒体查询包成 @media', async () => {
    const { html, result } = await run(page('<link rel="stylesheet" href="main.css">'), {
      'main.css': '@import "base.css";\n@import url(print.css) print;\nbody{margin:0}',
      'base.css': 'h1{color:blue}',
      'print.css': 'body{color:black}',
    });
    expect(result.failures).toEqual([]);
    expect(html).toContain('h1{color:blue}');
    expect(html).toContain('@media print');
    expect(html).not.toContain('@import');
  });

  it('<script src> → <script>，内容原样保留', async () => {
    const { html, result } = await run(page('', '<script src="app.js"></script>'), {
      'app.js': "document.title = 'ok';",
    });
    expect(html).not.toContain('src="app.js"');
    expect(html).toContain("document.title = 'ok';");
    expect(result.inlined).toEqual(['app.js']);
  });

  it('🔴 defer 脚本被挪到 </body> 前 —— 内联脚本会忽略 defer，留在 head 会在 body 存在之前执行', async () => {
    const { html } = await run(
      page('<script defer src="app.js"></script>', '<p id="p">x</p>'),
      { 'app.js': 'window.__deferRan = true;' },
    );
    // 脚本内容必须出现在 <p> 之后（即 body 末尾），而不是 head 里
    expect(html.indexOf('__deferRan')).toBeGreaterThan(html.indexOf('<p id="p">'));
  });

  it('非 defer 脚本留在原位（不动时序）', async () => {
    const { html } = await run(page('<script src="app.js"></script>', '<p id="p">x</p>'), {
      'app.js': 'window.__headRan = true;',
    });
    expect(html.indexOf('__headRan')).toBeLessThan(html.indexOf('<p id="p">'));
  });

  it('js 里出现 `</script` 会被转义，否则会提前截断脚本', async () => {
    const { html } = await run(page('', '<script src="app.js"></script>'), {
      'app.js': 'const s = "</script>";',
    });
    expect(html).toContain('<\\/script>');
  });

  it('<img src> → data:，子目录里的也能读到', async () => {
    const { html, result } = await run(page('', '<img id="a" src="fig1.png"><img id="b" src="assets/deep.png">'), {
      'fig1.png': 'A',
      'assets/deep.png': 'B',
    });
    expect(html).not.toContain('src="fig1.png"');
    expect(html).not.toContain('src="assets/deep.png"');
    expect(result.inlined).toEqual(['fig1.png', 'assets/deep.png']);
  });

  it('srcset 的每一项都换掉（否则窄屏会取到没换的那个）', async () => {
    const { html, result } = await run(page('', '<img srcset="s.png 1x, s2.png 2x">'), {
      's.png': 'S1',
      's2.png': 'S2',
    });
    expect(html).not.toMatch(/srcset="s\.png/);
    expect(result.inlined).toEqual(['s.png', 's2.png']);
    expect((html.match(/data:image\/png/g) ?? []).length).toBe(2);
  });

  it('页内 <style> 里的 url() 相对**文档**解析', async () => {
    const { html, result } = await run(page('<style>#x{background:url(fig1.png)}</style>'), {
      'fig1.png': 'A',
    });
    expect(result.failures).toEqual([]);
    expect(html).toContain('data:image/png;base64,');
  });

  it('页面自带 <base href="assets/"> ⇒ 内联时**遵照**它解析', async () => {
    const { html, result } = await run(page('<base href="assets/"><img src="fig1.png">'), {
      'assets/fig1.png': 'IN-ASSETS',
    });
    expect(result.failures).toEqual([]);
    expect(result.inlined).toEqual(['assets/fig1.png']);
    expect(html).toContain('data:image/png;base64,');
  });

  it('同一份依赖只读一次（同一张图被引两次不会读两遍）', async () => {
    const { calls } = await run(page('', '<img src="a.png"><img src="./a.png">'), { 'a.png': 'A' });
    expect(calls).toEqual(['a.png']);
  });

  it('不动的：data: / 远程 / 锚点', async () => {
    const { html } = await run(
      page('<link rel="stylesheet" href="https://cdn.x/a.css">'),
      {},
    );
    expect(html).toContain('https://cdn.x/a.css');
  });

  it('rel 里除了 stylesheet 还有别的词 ⇒ 不当样式表处理（如 rel=alternate stylesheet）', async () => {
    const { result } = await run(page('<link rel="preconnect" href="x.css">'), { 'x.css': 'a{}' });
    expect(result.inlined).toEqual([]);
    expect(result.failures).toEqual([]);
  });
});

describe('inlineDependencies · 读不到时不许静默降级', () => {
  it('依赖不存在 ⇒ 进失败清单，并把引用改写成绝对 URL（不是悄悄放过）', async () => {
    const { result, html } = await run(page('<link rel="stylesheet" href="missing.css">'), {});
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.path).toBe('missing.css');
    expect(result.failures[0]?.reason).toContain('读不到');
    // 🔴 第七轮起**不再**把原引用留在相对位置上（旧版留给调用方插 base 兜底）。
    //    留在相对位置 = 副本一挪到别的目录就指向副本自己那个目录（那里什么都没有）；
    //    而插 base 又会把页内锚点一并拉走（用户报的「没法点」）。⇒ 只改这一个引用。
    expect(html).toContain('href="file:///C:/proj/missing.css"');
    expect(result.rebased).toEqual(['file:///C:/proj/missing.css']);
  });

  it('越界依赖（../shared/x.css）⇒ 失败清单，理由写明「不在所选目录内」', async () => {
    const { result, html } = await run(page('<link rel="stylesheet" href="../shared/x.css">'), {});
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toContain('不在所选目录内');
    // 目录句柄读不到上层目录，但**改写照样能做**（绝对 URL 不需要句柄）—— 这是第七轮的要点之一。
    expect(result.rebased).toEqual(['file:///C:/shared/x.css']);
    expect(html).toContain('href="file:///C:/shared/x.css"');
  });

  it('⚠️ <iframe> 明说「暂不支持内联」，而不是当它不存在', async () => {
    // 🔴 这条用例**不能用 `DOMParser` 造游离文档**：happy-dom 会在 `<iframe>` 连上文档时
    // 调 `#loadPage`，失败后往 `ownerDocument.defaultView.console` 派发错误，而游离文档的
    // `defaultView` 是 null ⇒ happy-dom 自己崩，以 Unhandled Rejection 污染整轮输出。
    // 实测：`disableIframePageLoading` 只能把「真导航（网络 I/O）」换成「立刻派发错误」，
    // **换不掉崩溃**；`src` 属性变化也会重新触发加载，所以「先挂载后设 src」也绕不开。
    // ⇒ 改用**带 window 的全局 document**，并静音那条预期内的 console 错误（环境行为，不是被测行为）。
    const win = document.defaultView as unknown as { console: { error: unknown } };
    const origError = win.console.error;
    win.console.error = () => {};
    try {
      document.body.innerHTML = '<iframe src="sub.html"></iframe>';
      const out = await inlineDependencies(document, {
        href: HREF,
        read: async () => enc('<p>sub</p>'),
      });
      expect(out.failures).toHaveLength(1);
      expect(out.failures[0]?.reason).toContain('iframe');
      // 🔴 唯一**刻意不改写**的一类：`<iframe src>` 是**帧导航**，而跨 file 源的帧导航
      //    正是被 Chrome `unique origins` 拦下的那一类 ⇒ 改写等于主动制造那条报错。
      expect(out.rebased).toEqual([]);
      expect(document.querySelector('iframe')?.getAttribute('src')).toBe('sub.html');
    } finally {
      win.console.error = origError;
      document.body.innerHTML = '';
    }
  });

  it('reader 自己抛异常 ⇒ 当「读不到」处理，不让异常冒出去', async () => {
    const copy = docOf(page('<img src="a.png">'));
    const out = await inlineDependencies(copy, {
      href: HREF,
      read: async () => {
        throw new Error('boom');
      },
    });
    expect(out.failures).toHaveLength(1);
  });

  it('体积超上限 ⇒ 失败清单（不把文件撑到无法分享）', async () => {
    const copy = docOf(page('<img src="big.png">'));
    const out = await inlineDependencies(copy, {
      href: HREF,
      read: async () => enc('x'.repeat(64)),
      maxBytes: 10,
    });
    expect(out.failures[0]?.reason).toContain('体积上限');
  });
});

describe('inlineDependencies · 不往用户文件里留编辑器痕迹', () => {
  it('🔴 一个 `data-ep-` 都不许产生（否则保存会被自己的残留护栏拦下）', async () => {
    const { html } = await run(
      page('<link rel="stylesheet" href="s.css">', '<img src="a.png"><script src="j.js"></script>'),
      { 's.css': '#x{background:url(b.png)}', 'b.png': 'B', 'a.png': 'A', 'j.js': 'void 0;' },
    );
    expect(html).not.toContain('data-ep-');
    expect(html).not.toContain('ep-');
  });

  it('<style> 是原始文本元素：内容里的 > 与 & 不被转义（否则 css 选择器会坏）', async () => {
    const { html } = await run(page('<link rel="stylesheet" href="s.css">'), {
      's.css': 'div > p & span { color: red }',
    });
    expect(html).toContain('div > p & span { color: red }');
    expect(html).not.toContain('&gt;');
  });

  it('不修改原文档（变换只作用在传进来的副本上）', async () => {
    const live = docOf(page('<link rel="stylesheet" href="s.css">'));
    const copy = docOf(page('<link rel="stylesheet" href="s.css">'));
    await inlineDependencies(copy, { href: HREF, read: async () => enc('a{}') });
    expect(live.querySelector('link[href]')).not.toBeNull();
    expect(copy.querySelector('link[href]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-9 第七轮：内联不成的引用**改写成绝对 URL**（2026-09-23 深夜用户裁决）
//
// 为什么非改不可、以及为什么不能再用 `<base>` 兜底：见 `inline-deps.ts` 文件头。
// 一句话：base 会把页内 `#锚点` 一并解析到原目录 ⇒ 副本点导航就跳出去，
// 随后 Chrome 把导航判成跨 file 源而全拦（`'file:' URLs are treated as unique security origins`）。
// ─────────────────────────────────────────────────────────────────────────────
describe('inlineDependencies · 读不到的引用改写成绝对 URL（第七轮）', () => {
  it('🔴 css 里的 `url()` 读不到 ⇒ 在 `<style>` 里改写成绝对 URL（`<style>` 的相对路径按文档解析，留着就指错）', async () => {
    const { html, result } = await run(page('<link rel="stylesheet" href="css/a.css">'), {
      'css/a.css': '#x{background:url(bg.png)}', // bg.png 不在
    });
    expect(result.inlined).toEqual(['css/a.css']);
    expect(result.failures.map((f) => f.path)).toEqual(['css/bg.png']);
    // 🔴 注意基准是**那个 css 文件**所在目录（`css/`），不是文档目录
    expect(html).toContain('url("file:///C:/proj/css/bg.png")');
    expect(html).not.toContain('url(bg.png)');
    expect(result.rebased).toEqual(['file:///C:/proj/css/bg.png']);
  });

  it('🔴 css 里的 `@import` 读不到 ⇒ 改写成绝对 URL，并保留 media 条件', async () => {
    const { html, result } = await run(page('<link rel="stylesheet" href="main.css">'), {
      'main.css': '@import url(print.css) print;',
    });
    expect(result.failures.map((f) => f.path)).toEqual(['print.css']);
    expect(html).toContain('@import url("file:///C:/proj/print.css") print;');
  });

  it('srcset 里的候选读不到 ⇒ 那一项换成绝对 URL，且**保留 descriptor**', async () => {
    const { html, result } = await run(page('', '<img srcset="s.png 1x, s2.png 2x">'), {});
    expect(result.rebased).toEqual(['file:///C:/proj/s.png', 'file:///C:/proj/s2.png']);
    expect(html).toContain('srcset="file:///C:/proj/s.png 1x, file:///C:/proj/s2.png 2x"');
  });

  it('🔴 页内 `#锚点` 与外部链接**一律不动** —— 这正是用户报的「没法点」的根因来源', async () => {
    const { html, result } = await run(
      page('<link rel="stylesheet" href="missing.css">', '<a href="#top">a</a><a href="https://x.y/z">b</a>'),
      {},
    );
    // 只有那个读不到的依赖被改写
    expect(result.rebased).toEqual(['file:///C:/proj/missing.css']);
    // 锚点保持原样 ⇒ 副本里点它仍是**文档内跳转**，不会跑出去
    expect(html).toContain('href="#top"');
    expect(html).toContain('href="https://x.y/z"');
    // 反向确认：这一轮确实做了改写（否则上面的「不动」可能只是什么都没干）
    expect(html).toContain('href="file:///C:/proj/missing.css"');
  });

  it('没有 `<base>` 被插进来（第七轮把这个兜底整个摘掉了）', async () => {
    const { html } = await run(page('<link rel="stylesheet" href="missing.css">'), {});
    expect(html).not.toContain('<base');
  });
});
