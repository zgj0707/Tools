// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  buildSaveHtml,
  collectSiblingDeps,
  directoryOf,
  residueBlocker,
  saveCurrentDocument,
  suggestedNameFrom,
  writeBack,
  writeDirect,
  type FileHandleLike,
  type SavePicker,
} from '../../src/extension/save';
import {
  inlineDepsBreadcrumb,
  inlineDepsTitle,
  saveCaveats,
  saveMessage,
  saveTitle,
} from '../../src/extension/ui/toast';
import type { HandleLike, HandleStore } from '../../src/extension/handle-store';

/**
 * 这里测三件真实浏览器里**没法便宜地测**的事：
 *   ① 写回前清理干净不干净（纯逻辑，构造各种脏 DOM 即可）；
 *   ② 原生保存框的调用参数与错误分支（真机里只能靠人手点，单测里注入假 picker 全覆盖）；
 *   ③ 「残留未清干净就拒绝写入」这条绊线会不会真的拦住（`picker` 是否被调用的断言）。
 *
 * 真机上唯一无法自动化的那一环 —— 原生框真的弹出并返回 handle —— 是门禁 G1，
 * 由人手点一次确认；这里不假装覆盖了它。
 */

function docOf(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 记录被写入的内容与调用参数的假 picker。 */
function fakePicker(options?: { failWith?: string }): { picker: SavePicker; writes: string[]; calls: unknown[] } {
  const writes: string[] = [];
  const calls: unknown[] = [];
  const handle: FileHandleLike = {
    name: 'demo.html',
    createWritable: async () => ({
      write: async (data: string) => {
        writes.push(data);
      },
      close: async () => {},
    }),
  };
  const picker: SavePicker = async (opts) => {
    calls.push(opts);
    if (options?.failWith) {
      const err = new Error('boom');
      err.name = options.failWith;
      throw err;
    }
    return handle;
  };
  return { picker, writes, calls };
}

describe('suggestedNameFrom', () => {
  it('从 file:// URL 取文件名，并解出百分号编码', () => {
    expect(suggestedNameFrom('file:///C:/Users/me/%E7%A8%BF.html')).toBe('稿.html');
  });

  it('丢掉 query 与 hash', () => {
    expect(suggestedNameFrom('file:///C:/a/b.html?v=2#top')).toBe('b.html');
  });

  it('没有 .html 扩展名时补一个（原生框按扩展名过滤，否则会存成无扩展名文件）', () => {
    expect(suggestedNameFrom('file:///C:/a/README')).toBe('README.html');
  });

  it('拿不到路径时退回默认名，不抛', () => {
    expect(suggestedNameFrom('not a url')).toBe('page.html');
    expect(suggestedNameFrom('file:///')).toBe('page.html');
  });

  it('文件名里带非法百分号时不抛，用原文', () => {
    expect(suggestedNameFrom('file:///C:/a/100%off.html')).toBe('100%off.html');
  });
});

describe('buildSaveHtml · 写回前必须清干净', () => {
  it('移除宿主 #ep-root（Shadow 里的 UI 本就不会被序列化，宿主也一并去掉）', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><body><p id="keep">正文</p><div id="ep-root" data-ep-root=""></div></body></html>',
    );
    const { html, residue } = buildSaveHtml(doc);
    expect(html).not.toContain('ep-root');
    expect(html).toContain('id="keep"');
    expect(residue).toEqual([]);
  });

  it('清掉 contenteditable / data-ep-* / ep- 临时 class，但**保留用户自己的 class**', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><body>' +
        '<p id="p" class="user-card ep-draft" contenteditable="true" data-ep-editing="true">x</p>' +
        '</body></html>',
    );
    const { html, residue } = buildSaveHtml(doc);
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('data-ep-editing');
    expect(html).not.toContain('ep-draft');
    expect(html).toContain('user-card');
    expect(residue).toEqual([]);
  });

  it('🔴 保留用户在编辑器里做的改动与行内格式', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><body>' +
        '<p id="p" style="font-weight:700;color:rgb(192, 57, 43)">结论：<strong>留存下滑</strong></p>' +
        '</body></html>',
    );
    const { html } = buildSaveHtml(doc);
    expect(html).toContain('<strong>留存下滑</strong>');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('rgb(192, 57, 43)');
  });

  it('保留原 doctype；原本没有 doctype 就不强加（否则会改掉文档的解析模式）', () => {
    expect(buildSaveHtml(docOf('<!DOCTYPE html><html><body>x</body></html>')).html.startsWith('<!DOCTYPE html>\n')).toBe(
      true,
    );
    expect(buildSaveHtml(docOf('<html><body>x</body></html>')).html.startsWith('<html>')).toBe(true);
  });

  it('如实上报「页面含脚本」—— 写回会把脚本运行后的 DOM 固化，用户必须被告知', () => {
    const withScript = docOf('<!DOCTYPE html><html><body><script>1+1</script></body></html>');
    const without = docOf('<!DOCTYPE html><html><body><p>纯静态</p></body></html>');
    expect(buildSaveHtml(withScript).hadScript).toBe(true);
    expect(buildSaveHtml(without).hadScript).toBe(false);
  });

  it('原文档里的用户 <script> 原样保留（我们只清自己的痕迹）', () => {
    const doc = docOf('<!DOCTYPE html><html><body><script>window.x=1</script></body></html>');
    expect(buildSaveHtml(doc).html).toContain('window.x=1');
  });
});

describe('writeBack · 原生保存框的参数与错误分支', () => {
  it('传对文件名与类型过滤，并把整份 html 写进去', async () => {
    const { picker, writes, calls } = fakePicker();
    const result = await writeBack('<html>x</html>', '稿.html', picker);
    expect(result).toEqual({ outcome: 'saved', detail: 'demo.html' });
    expect(writes).toEqual(['<html>x</html>']);
    expect(calls[0]).toEqual({
      suggestedName: '稿.html',
      types: [{ description: '网页文件', accept: { 'text/html': ['.html', '.htm'] } }],
    });
  });

  it('用户点取消（AbortError）⇒ cancelled，而不是 failed', async () => {
    const { picker } = fakePicker({ failWith: 'AbortError' });
    expect((await writeBack('x', 'a.html', picker)).outcome).toBe('cancelled');
  });

  it('SecurityError / NotAllowedError ⇒ unsupported（协议或权限层面就没让走，不是磁盘问题）', async () => {
    expect((await writeBack('x', 'a.html', fakePicker({ failWith: 'SecurityError' }).picker)).outcome).toBe(
      'unsupported',
    );
    expect((await writeBack('x', 'a.html', fakePicker({ failWith: 'NotAllowedError' }).picker)).outcome).toBe(
      'unsupported',
    );
  });

  it('其他异常 ⇒ failed，并带上错误名供排查', async () => {
    const result = await writeBack('x', 'a.html', fakePicker({ failWith: 'QuotaExceededError' }).picker);
    expect(result.outcome).toBe('failed');
    expect(result.detail).toBe('QuotaExceededError');
  });

  it('环境不支持（picker 为 null）⇒ unsupported，不抛', async () => {
    expect((await writeBack('x', 'a.html', null)).outcome).toBe('unsupported');
  });
});

describe('saveCurrentDocument · 一键闭环', () => {
  it('端到端：写进去的内容来自清理后的副本，且不含任何编辑器痕迹', async () => {
    const doc = docOf(
      '<!DOCTYPE html><html><body><p class="ep-x" data-ep-editing="true" contenteditable="true">改过的字</p>' +
        '<div id="ep-root"></div></body></html>',
    );
    const { picker, writes } = fakePicker();
    const result = await saveCurrentDocument(doc, 'file:///C:/a/%E7%A8%BF.html', picker);

    expect(result.outcome).toBe('saved');
    const written = writes[0]!;
    expect(written).toContain('改过的字');
    expect(written).not.toContain('ep-');
    expect(written).not.toContain('contenteditable');
    // 建议文件名一路传到原生框
    expect(result.detail).toBe('demo.html');
  });

  it('🔴 残留判定：干净为 null，非空时取前三条（写回前的最后一道闸）', () => {
    // 说明为什么只测「判定」而不测「触发」：strip 与 collect 口径同源逐条对应，
    // 触发条件在当前代码下不可达（save.ts 里 `dirty` 的注释写了这条）。
    // 与其编造一个假输入去点亮它，不如把判定函数本身钉死 + 断言干净路径确实调用了 picker。
    expect(residueBlocker([])).toBeNull();
    expect(residueBlocker(['a', 'b', 'c', 'd'])).toBe('a、b、c');
  });

  it('干净路径**确实**会调起原生框（反向确认不是「什么都没做就返回成功」）', async () => {
    const doc = docOf('<!DOCTYPE html><html><body><p id="p">x</p></body></html>');
    const { picker, calls } = fakePicker();
    const result = await saveCurrentDocument(doc, 'file:///C:/a/b.html', picker);
    expect(result.outcome).toBe('saved');
    expect(calls.length).toBe(1);
  });
});

describe('saveMessage · 用户看到的就是这句话（第六轮方案 A：下载口径 + noDir）', () => {
  // ⚠️ 第六轮（2026-09-23 深夜，方案 A）：保存永远 0 框。`rememberedDir` 从保存结果里
  // 删掉了（保存不再弹框、不再首次记住目录 —— 那是「内联依赖」动作的事）。
  // 新增 `noDir`：保存没拿到句柄 ⇒ 副本不自包含，如实说清并指路「内联依赖」。

  it('成功：报出**交给下载的文件名**，并说清落点是下载文件夹、重名自动加序号', () => {
    const msg = saveMessage('saved', '稿_改.html');
    expect(msg.text).toBe('已开始下载 稿_改.html：文件在浏览器的下载文件夹（重名时自动加序号）');
    expect(msg.tone).toBe('info');
  });

  it('含脚本时补一句告知 —— 这不是细节，是「改动为何可能看起来没生效」的解释', () => {
    expect(saveMessage('saved', '稿_改.html', true).text).toContain('脚本');
  });

  it('残留 / 失败：都是 error 语气，且「残留」明说是我们主动放弃另存', () => {
    expect(saveMessage('dirty', 'data-ep-*@<p>').text).toContain('已放弃另存');
    expect(saveMessage('failed', 'QuotaExceededError').text).toContain('QuotaExceededError');
  });

  it('🔴 成功时**不提任何框** —— 落盘（下载）不需要框', () => {
    const text = saveMessage('saved', 'index_改.html').text;
    expect(text).not.toContain('框');
  });

  it('🔴 `notSelfContained`（真有依赖没内联进来）⇒ 如实说清「不自包含」并指路「内联依赖」', () => {
    const msg = saveMessage('saved', 'index_改.html', undefined, { notSelfContained: true });
    expect(msg.text).toContain('不自包含');
    expect(msg.text).toContain('内联依赖');
    // 自包含时不加这句
    expect(saveMessage('saved', 'index_改.html', undefined, { notSelfContained: false }).text).not.toContain(
      '不自包含',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-7：多文件页面防护
//
// 起因是一次真实事故：`index.html` + `styles.css` + `app.js` 三件套，用户把 html
// 存到了桌面，两个依赖没跟过去 ⇒ 整页版式塌掉，用户以为是编辑器把内容改坏了。
// 于是两条防线：① 记住上次写回的 handle，以后不弹框、也就不存在「选错位置」；
// ② 在动手之前就把「依赖哪几个文件、必须存回哪个目录」说出来。
// ─────────────────────────────────────────────────────────────────────────────

describe('collectSiblingDeps · 同目录相对依赖', () => {
  it('计相对路径的样式表 / 脚本 / 图片', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head>' +
        '<body><script src="app.js"></script><img src="images/fig1.png"></body></html>',
    );
    expect(collectSiblingDeps(doc).names).toEqual(['styles.css', 'app.js', 'images/fig1.png']);
  });

  it('外链 / 协议相对 / 锚点 / 根相对 / data: ⇒ 不计（换目录也不会失效）', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><head>' +
        '<link rel="stylesheet" href="https://cdn.example.com/x.css">' +
        '<link rel="stylesheet" href="//cdn.example.com/y.css">' +
        '<link rel="stylesheet" href="#theme">' +
        '</head><body>' +
        '<script src="/assets/root.js"></script>' +
        '<img src="data:image/png;base64,iVBORw0KGgo=">' +
        '<object data="mailto:a@b.c"></object>' +
        '</body></html>',
    );
    expect(collectSiblingDeps(doc).names).toEqual([]);
  });

  it('选择器覆盖到 object / video / audio / source（漏掉哪一类就会整块内容丢）', () => {
    // 夹具里**刻意不放 `<iframe src>`**：happy-dom 会真的去尝试导航，失败后往
    // 游离 document 的 `window.console` 派发错误 ⇒ 变成一行 Unhandled Rejection 噪音。
    // 而 `iframe[src]` 与其余几项是同一个联合选择器里的一条，没有单独的逻辑分支，
    // 所以这里不补它并不会漏测判定逻辑。
    const doc = docOf(
      '<!DOCTYPE html><html><body>' +
        '<object data="embed.svg"></object>' +
        '<video src="clip.mp4"><source src="clip.webm"></video>' +
        '<audio src="bgm.mp3"></audio>' +
        '</body></html>',
    );
    expect(collectSiblingDeps(doc).names).toEqual(['embed.svg', 'clip.mp4', 'clip.webm', 'bgm.mp3']);
  });

  it('🔴 `data-href` 不能被当成 `href`（第一版用正则扫源码，误报 110 个假依赖，真依赖只有 2 个）', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><body>' +
        '<a data-href="doc-01-s1">锚</a><div data-src="ghost.js"></div>' +
        '<link rel="stylesheet" href="styles.css">' +
        '</body></html>',
    );
    expect(collectSiblingDeps(doc).names).toEqual(['styles.css']);
  });

  it('`<a href="other.html">` 不算依赖 —— 它指向导航目标，不影响本页渲染', () => {
    const doc = docOf('<!DOCTYPE html><html><body><a href="other.html">下一页</a></body></html>');
    expect(collectSiblingDeps(doc).names).toEqual([]);
  });

  it('丢掉 query / hash；同一份文件的不同写法（`app.js` / `./app.js`）只报一次', () => {
    const doc = docOf(
      '<!DOCTYPE html><html><body><script src="app.js?v=3"></script><script src="./app.js#x"></script></body></html>',
    );
    expect(collectSiblingDeps(doc).names).toEqual(['app.js']);
  });

  it('同目录与子目录的同名文件**不能**被并成一条（去重的反向确认：别去过头的）', () => {
    const doc = docOf('<!DOCTYPE html><html><body><img src="a.png"><img src="sub/a.png"></body></html>');
    expect(collectSiblingDeps(doc).names).toEqual(['a.png', 'sub/a.png']);
  });

  it('超出 cap 时只列前几个，并在 more 里报出还剩多少', () => {
    const links = Array.from({ length: 9 }, (_, i) => `<script src="s${i}.js"></script>`).join('');
    const doc = docOf(`<!DOCTYPE html><html><body>${links}</body></html>`);
    const got = collectSiblingDeps(doc, 3);
    expect(got.names).toEqual(['s0.js', 's1.js', 's2.js']);
    expect(got.more).toBe(6);
  });

  it('空属性 / 属性里塞了换行的 ⇒ 跳过（不像一个资源路径）', () => {
    const doc = docOf('<!DOCTYPE html><html><body><img src=""><img src="a\nb.png"></body></html>');
    expect(collectSiblingDeps(doc).names).toEqual([]);
  });
});

describe('directoryOf · 只用于显示（FSA 给不到 handle 的路径）', () => {
  it('Windows 盘符路径转成习惯的反斜杠，且带结尾分隔符', () => {
    expect(directoryOf('file:///C:/Users/me/site/index.html')).toBe('C:\\Users\\me\\site\\');
  });

  it('百分号编码的目录名要解出来（用户目录名常是中文）', () => {
    expect(directoryOf('file:///C:/a/%E6%96%87%E7%A8%BF/index.html')).toBe('C:\\a\\文稿\\');
  });

  it('非 Windows 形态保持原样；解析不了就返回空串', () => {
    expect(directoryOf('file:///home/me/site/index.html')).toBe('/home/me/site/');
    expect(directoryOf('not a url')).toBe('');
  });
});

describe('writeDirect · 不弹框直接写', () => {
  it('写成功 ⇒ saved + direct 标记（调用方靠它决定提示措辞）', async () => {
    const writes: string[] = [];
    const handle: FileHandleLike = {
      name: 'index.html',
      createWritable: async () => ({
        write: async (d: string) => {
          writes.push(d);
        },
        close: async () => {},
      }),
    };
    expect(await writeDirect('<html>x</html>', handle)).toEqual({
      outcome: 'saved',
      detail: 'index.html',
      direct: true,
    });
    expect(writes).toEqual(['<html>x</html>']);
  });

  it('权限层面被挡 ⇒ unsupported；其余异常 ⇒ failed（两种都要能区分）', async () => {
    const mk = (errName: string): FileHandleLike =>
      ({
        name: 'a.html',
        createWritable: async () => {
          const err = new Error('boom');
          err.name = errName;
          throw err;
        },
      }) as unknown as FileHandleLike;
    expect((await writeDirect('x', mk('NotAllowedError'))).outcome).toBe('unsupported');
    expect((await writeDirect('x', mk('InvalidStateError'))).outcome).toBe('failed');
  });
});

/** 内存版 handle store：这里只验「接线对不对」，真 IndexedDB 由 handle-store 自己的测试覆盖。 */
function fakeStore(known?: HandleLike): { store: HandleStore; map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  if (known) map.set('file:///C:/a/index.html', known);
  return {
    map,
    store: {
      load: async (k) => (map.get(k) as HandleLike | undefined) ?? null,
      save: async (k, v) => {
        map.set(k, v);
      },
    },
  };
}

function writableHandle(name: string, permission: PermissionState = 'granted'): { handle: HandleLike; writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    handle: {
      name,
      createWritable: async () => ({
        write: async (d: string) => {
          writes.push(d);
        },
        close: async () => {},
      }),
      queryPermission: async () => permission,
      requestPermission: async () => permission,
    },
  };
}

const CLEAN_DOC = '<!DOCTYPE html><html><body><p>x</p></body></html>';
const HOME = 'file:///C:/a/index.html';

describe('saveCurrentDocument × handle 持久化 · 「以前弹框选对位置」这件事现在消失了', () => {
  it('上次记下的 handle 还在 ⇒ 不弹框，直接写回同一个文件', async () => {
    const { handle, writes } = writableHandle('index.html');
    const { store, map } = fakeStore(handle);
    const { picker, calls } = fakePicker();

    const result = await saveCurrentDocument(docOf(CLEAN_DOC), HOME, picker, store);

    expect(result.outcome).toBe('saved');
    expect(result.direct).toBe(true);
    expect(result.nameMismatch).toBe(false);
    expect(calls.length).toBe(0); // 原生框一次都没出现 —— 这正是根治点
    expect(writes.length).toBe(1); // 但内容确实写出去了
    expect(map.get(HOME)).toBe(handle);
  });

  it('写回的 handle 名字与当前文档不符 ⇒ nameMismatch 置位（那是最强的「可能存错地方」信号）', async () => {
    const { handle } = writableHandle('index (1).html');
    const { store } = fakeStore(handle);
    const result = await saveCurrentDocument(docOf(CLEAN_DOC), HOME, fakePicker().picker, store);
    expect(result.direct).toBe(true);
    expect(result.nameMismatch).toBe(true);
  });

  it('没记过 ⇒ 退回弹框；并**在写成功后**把这次选的 handle 记下来供下次直接用', async () => {
    const { store, map } = fakeStore();
    const { picker, calls } = fakePicker();
    const result = await saveCurrentDocument(docOf(CLEAN_DOC), HOME, picker, store);

    expect(result.outcome).toBe('saved');
    expect(result.direct).toBeUndefined();
    expect(calls.length).toBe(1);
    expect(map.size).toBe(1);
    expect((map.get(HOME) as HandleLike).name).toBe('demo.html');
  });

  it('记下的 handle 权限没了（denied）⇒ 退回弹框，而不是静默不保存', async () => {
    const { handle } = writableHandle('index.html', 'denied');
    const { store } = fakeStore(handle);
    const { picker, calls } = fakePicker();
    const result = await saveCurrentDocument(docOf(CLEAN_DOC), HOME, picker, store);
    expect(result.outcome).toBe('saved');
    expect(result.direct).toBeUndefined();
    expect(calls.length).toBe(1);
  });

  it('直接写抛错（句柄过期 / 文件被移走）⇒ 退回弹框，结果不会比 P0-5 更差', async () => {
    const bad = {
      name: 'index.html',
      createWritable: async () => {
        const err = new Error('gone');
        err.name = 'NotFoundError';
        throw err;
      },
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission: async () => 'granted' as PermissionState,
    } as unknown as HandleLike;
    const { store } = fakeStore(bad);
    const { picker, calls } = fakePicker();
    const result = await saveCurrentDocument(docOf(CLEAN_DOC), HOME, picker, store);
    expect(result.outcome).toBe('saved');
    expect(calls.length).toBe(1);
  });

  it('没有 store（环境没有 IndexedDB）⇒ 行为与 P0-5 完全一致', async () => {
    const { picker, calls } = fakePicker();
    const result = await saveCurrentDocument(docOf(CLEAN_DOC), HOME, picker, null);
    expect(result.outcome).toBe('saved');
    expect(calls.length).toBe(1);
  });

  // 注：清理自检（`dirty`）排在直接写回**之前**这条顺序，无法在这里观测 ——
  // 该分支在当前代码下不可达（见 save.ts 的说明）。与其造一个假输入去点亮它，
  // 不如把这条备注写在这里，防止后来者误以为「没测就是没做」。
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-9：同目录自包含另存形态下的文案（第五轮改下载口径）
//
// ⚠️ 前身 `depsWarning`（「这些文件必须和 html 待在一起」）已被移除两次口径：
//   · 它在「就地覆写」形态下是对的（写回时文件可能被存到别处，依赖不跟走就整页裸奔
//     —— 真实事故，见 07）；改成旁路另存后依赖**本就不动**，告警的前提消失了；
//   · P0-9 起依赖**会被内联进副本**，于是提示不但要留，方向还整个反过来：
//     从「别把它们落下」变成「它们已经装进去了，这一份可以发出去」。
// 取而代之的是 `saveCaveats`：只说**真的成立**的那几条。
// 第五轮再删两条：`dirMatched`（句柄目录不再是落点）与 `elsewhere`（按钮退场）。
// ─────────────────────────────────────────────────────────────────────────────
describe('saveTitle / saveCaveats · 另存之前说清、另存之后补一句', () => {
  it('不可用时先说清「为什么点了没用」', () => {
    expect(saveTitle({ available: false })).toContain('下载能力');
  });

  it('🔴 无依赖时保持一句话：落点=下载文件夹、重名自动加序号、不弹框、原文件不会被改动', () => {
    expect(saveTitle({ available: true, target: 'index_改.html' })).toBe(
      '另存为 index_改.html，下载到浏览器的下载文件夹（重名时自动加序号），原文件不会被改动；点一下就开始下载，全程不弹框。页面没有同目录依赖，这一份可以直接拉出去分享',
    );
  });

  it('连 `target` 都没给时不编一个假文件名（去掉它比说错它好）', () => {
    const t = saveTitle({ available: true });
    expect(t).toContain('原文件名_改');
    expect(t).not.toContain('undefined');
  });

  it('有依赖时明说「内联进副本」要靠旁边的「内联依赖」按钮 —— 保存本身 0 框', () => {
    const t = saveTitle({ available: true, target: 'index_改.html', deps: ['styles.css'], more: 1 });
    expect(t).toContain('styles.css 等 2 个');
    expect(t).toContain('内联依赖');
    expect(t).toContain('自包含');
    // 🔴 方案 A：保存 title **不再**预告「首次只读框」（保存不弹框）
    expect(t).not.toContain('只读目录框');
    expect(t).not.toContain('首次会弹');
  });

  it('🔴 无依赖时保持一句话：落点=下载文件夹、不弹框、原文件不会被改动', () => {
    expect(saveTitle({ available: true, target: 'index_改.html' })).toBe(
      '另存为 index_改.html，下载到浏览器的下载文件夹（重名时自动加序号），原文件不会被改动；点一下就开始下载，全程不弹框。页面没有同目录依赖，这一份可以直接拉出去分享',
    );
  });

  it('🔴 提醒**各自独立**：什么都没发生时不报任何一条（恒定报警 = 没有报警）', () => {
    expect(saveCaveats({})).toEqual([]);
    expect(saveCaveats({ failedDeps: [], rebased: [] })).toEqual([]);
  });

  it('🔴 有依赖没内联进来时必须说，且说清这份副本**不自包含**（最坏的失败是「看着像好的」）', () => {
    const [one] = saveCaveats({
      failedDeps: [{ path: 'a.css', reason: '读不到（文件不存在，或所在目录没有读取权限）' }],
      rebased: ['file:///C:/proj/a.css'],
    });
    expect(one).toContain('a.css');
    expect(one).toContain('没能内联');
    expect(one).toContain('不自包含');
    // 改写过了 ⇒ 必须把「本机照常打开」这句说清楚，否则用户会以为副本当场就是坏的
    expect(one).toContain('本机照常打开');
  });

  it('🔴 一个引用都没改写（例如只有 `<iframe>`，那是刻意不改的）⇒ **不许**说已被兜住', () => {
    // 第七轮起不再有「插了兜底 base / 页面自带 base / 连 base 都插不进去」三种收场 ——
    // 那三条都是旧兜底路线的话术。现在只剩「改写过的」与「刻意没改写的」两类，必须分得开。
    const [none] = saveCaveats({
      failedDeps: [{ path: 'frame.html', reason: '暂不支持内联 <iframe>（等于搬进整份子文档）' }],
      rebased: [],
    });
    expect(none).toContain('没能改写也没能内联');
    expect(none).toContain('很可能直接读不到');
    expect(none).not.toContain('本机照常打开');
  });

  it('🔴 「页内跳转会被解析到原目录」这条话术整个消失（第七轮把它连根去掉了）', () => {
    // 旧版插兜底 base 时，页面上 189 个 `href="#…"` 会被一并解析到原目录 ⇒ 曾专门加过一条提醒，
    // 用户也正是因此报「没法点」。现在不插 base 了，这条副作用不存在 —— 任何输入都不许再冒出来。
    // ⚠️ 判别用的是旧版**独有**的措辞（「页内跳转」「兜底 base」），不能用「指向原目录」：
    //    新话术里的「已改写成指向原目录的绝对路径」是在说资源引用，与锚点无关，是正确的话。
    const out = saveCaveats({
      failedDeps: [{ path: 'a.css', reason: '读不到' }],
      rebased: ['file:///C:/proj/a.css'],
      memoryRejected: true,
    }).join('；');
    expect(out).not.toContain('页内跳转');
    expect(out).not.toContain('兜底 base');
  });

  it('🔴 记忆被自愈否决时必须解释「为什么读不到依赖」且给出出路', () => {
    const [one] = saveCaveats({ memoryRejected: true });
    expect(one).toContain('依赖目录');
    expect(one).toContain('没有这份原文件');
    expect(one).toContain('内联依赖');
  });

  it('🔴 `memoryRejected` 不为真时不提示（不恒真报警）', () => {
    expect(saveCaveats({ memoryRejected: false })).toEqual([]);
    expect(saveCaveats({ memoryRejected: undefined })).toEqual([]);
  });
});

describe('inlineDepsTitle / inlineDepsBreadcrumb · 「内联依赖」按钮与弹框前的面包屑', () => {
  it('🔴 有依赖时：说清「为什么弹框、弹完会怎样」', () => {
    const t = inlineDepsTitle({ available: true, deps: ['styles.css'], more: 1 });
    expect(t).toContain('styles.css 等 2 个');
    expect(t).toContain('只读目录框');
    expect(t).toContain('选完自动记住');
    expect(t).toContain('不再弹');
  });

  it('🔴 无依赖时提示「无需内联」—— 单文件页面不该诱导用户去弹框', () => {
    expect(inlineDepsTitle({ available: true })).toContain('无需内联');
  });

  it('不可用时说清「为什么点了没用」', () => {
    expect(inlineDepsTitle({ available: false })).toContain('目录读取能力');
  });

  it('🔴 面包屑：弹原生框**之前**先告诉用户「接下来要你选一次目录」', () => {
    const b = inlineDepsBreadcrumb();
    expect(b).toContain('目录选择框');
    expect(b).toContain('选中这份 html 所在的文件夹');
    expect(b).toContain('选完自动记住');
    expect(b).toContain('不再弹');
  });
});
