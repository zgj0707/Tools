// 写回原文件（P0-5）—— 这是**整个插件形态的立足点**：
// Figma 原生不吃 HTML，Canva 官方帮助页自述 HTML「无法在 Canva 中开启或编辑」，
// 两家都做不到「改完还是那份 HTML」。我们能做到，靠的就是这里。
//
// ── 为什么只能在**页面上下文**里调 FSA ──
// content script 里 XHR / fetch 读不到 `file://` 原文件（origin 'null' + CORS 拒绝）；
// MV3 的 service worker 的 fetch 只支持 http/https。而 `file://` 页面本身是安全上下文，
// `window.showSaveFilePicker` 实测存在、真实调用返回 `AbortError`
// （= 已通过安全检查、走到「弹原生框」那一步，仅因无头环境没有对话框而中止）。
// 证据：`qa/probes/file-protocol-capability.mjs`。
//
// ── 保存语义 ──
// 正式工具条路径在 saveOriginalDocument 中读取原文件字节，以 parse5 源码位置只替换发生变化的
// 文字/属性/局部元素内容；未修改区间原样保留。每次覆盖前先将原字节存入 IndexedDB 恢复点。
// 无法把加载时 DOM 映射回原源码、页面在运行时变化过大、编码无法保真或恢复点写入失败时拒绝覆盖。
// `buildSaveHtml` / `serializeDocument` 仍服务旧的另存路径和存量取证，不是工具条的主保存实现。

import { collectResidue, stripEditorArtifacts } from '../core/serialize/stripArtifacts';
import { EPX } from './anchors';
import { ensureWritable, looksLikeFileHandle, pathKeyOf, type HandleStore } from './handle-store';
import { captureSourceBaseline, decodeHtmlSource, encodeHtmlSource, patchHtmlSource } from './preserve-source';

export type SaveOutcome =
  /** 已写入（或已交给浏览器的写入通道）。 */
  | 'saved'
  /** 用户取消原件选择或覆盖确认；本次没有写入。 */
  | 'cancelled'
  /** 本页面不支持 FSA（非安全上下文 / 浏览器太老）。 */
  | 'unsupported'
  /** 保存器无法安全清理或映射源码 ⇒ 拒绝写入。 */
  | 'dirty'
  /** 其他失败（磁盘错误、权限被拒…）。 */
  | 'failed';

export interface SaveResult {
  outcome: SaveOutcome;
  /** 已写入的文件名，或失败原因。给 UI 显示用。 */
  detail?: string;
  /** 页面是否含业务脚本；动态变化无法安全映射到原源码时会阻止覆盖。 */
  hadScript?: boolean;
  /**
   * 这次**一个系统框都没弹** —— 用户完全没被打断。
   *
   * 各形态下的成立条件：
   *   · P0-7：写回了上次记住的那个文件（那次只有一个框可言，记住了就没框）；
   *   · P0-8：用记忆里的目录写进了 `_改/`；
   *   · 🔴 **P0-9：目录来自记忆（没弹目录框）** **且** **保存框被缺手势挡下（退化直写）**
   *     —— 两个条件同时成立才为真。P0-9 正常情况下保存框仍会弹（它还是用户改名 / 换位置的机会），
   *     那时它是 `undefined`，由 `SaveResult` 的兄弟字段 `via: 'dialog'` 表示。
   *
   * ⚠️ 别把它读成「用了记忆里的目录」：那是「少弹一个框」，不是「没弹框」。
   * 两者混起来，UI 就会在明明弹了保存框的时候说「未弹系统框」。
   */
  direct?: boolean;
  /**
   * 落盘的文件名与当前文档的名字不一致 —— **很可能存到了别的位置**。
   *
   * 这是能拿到的最强信号，但**不是充分条件**：同名也可能存错目录
   * （FSA 只给 `handle.name`，不给路径）。所以它只用来「提示」，
   * 不能用来「判定正确」。
   */
  nameMismatch?: boolean;
  /** 当前原件句柄，供装配层在本页会话内复用。 */
  handle?: FileHandleLike;
  /** 已选定或复用的句柄暂时不能写入；调用方应清除该句柄并要求重新选择。 */
  forgetHandle?: boolean;
  /** 写入前已在此浏览器保存了可恢复的原文件备份。 */
  backupAvailable?: boolean;
}

/** FSA 的最小结构化类型（不依赖 TS 的 DOM lib 是否带 FileSystemFileHandle）。 */
interface WritableLike {
  write(data: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
}
export interface FileHandleLike {
  readonly name: string;
  createWritable(): Promise<WritableLike>;
  getFile?(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface SavePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  /**
   * 让原生框**打开时就停在这个目录**（P0-9 的「自动定位到原文件所在处」）。
   *
   * 可以是 well-known 目录名（`'documents'`），也可以是一个 `FileSystemDirectoryHandle`。
   * 后者实测**被接受**：传真目录句柄与传 `'documents'` 拿到同一个 `AbortError`，
   * 而传伪句柄 / 数字会被 `TypeError` 拒（差分对照见 `qa/probes/save-picker-startin-capability.mjs`）。
   *
   * ⚠️ 「框真的停在那儿」是 OS 级窗口行为，自动化观测不到 ⇒ 由人手门禁 G1 确认。
   * 类型写 `unknown` 而不是 `FileSystemDirectoryHandle`：本仓库不依赖 TS 的 DOM lib 是否
   * 带这个类型，且句柄来自 `dir-save.ts` 的结构化类型。
   */
  startIn?: unknown;
}

export type SavePicker = (options: SavePickerOptions) => Promise<FileHandleLike>;

export interface OpenFilePickerOptions {
  id?: string;
  multiple?: boolean;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}

/** 打开已有文件的原生选择器；只选择，不创建新文件。 */
export type OpenFilePicker = (options: OpenFilePickerOptions) => Promise<FileHandleLike[]>;

export type ConfirmOverwrite = (message: string) => boolean;

/** 当前环境的 FSA 写文件选择器；不支持时返回 null。 */
export function browserPicker(): SavePicker | null {
  const fn = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

/** 当前环境的原件选择器；不支持时返回 null。 */
export function browserOpenFilePicker(): OpenFilePicker | null {
  const fn = (window as unknown as { showOpenFilePicker?: OpenFilePicker }).showOpenFilePicker;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

/**
 * 由当前地址猜一个建议文件名。
 * `file:///C:/Users/me/%E7%A8%BF.html` → `稿.html`；拿不到就退回 `page.html`。
 * 只影响原生框的默认名（用户仍可改），但省掉手打整个文件名的麻烦。
 */
export function suggestedNameFrom(href: string, fallback = 'page.html'): string {
  let path = '';
  try {
    path = new URL(href).pathname;
  } catch {
    return fallback;
  }
  const last = path.split('/').pop() ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // 非法百分号编码（用户文件名里真有 `%`）—— 用原文，不抛。
  }
  if (!name) return fallback;
  // 原生框按扩展名过滤，名字里必须带一个 .html/.htm，否则用户可能存成无扩展名文件。
  return /\.html?$/i.test(name) ? name : `${name}.html`;
}

/**
 * 文档依赖的**同目录相对资源**（`styles.css`、`app.js`、`fig1.png`…）。
 *
 * 为什么需要：写回是「另存为」语义 —— `showSaveFilePicker` 让用户重选位置，
 * 而**默认位置不是原文件的目录**。这类相对依赖一旦不跟着走，页面打开就是
 * 「整页样式丢失 / 交互失灵」，用户看到的现象与「编辑器把内容改坏了」几乎一样。
 * 真实案例见 `.workbuddy/memory/2026-09-23.md` 第八节。
 * ⇒ 侦测到就**必须把风险说出来**，不能让它静默发生。
 *
 * 只算**真的会随目录变化而失效**的那些：
 *   · 相对路径（`styles.css`）—— 会失效，计；
 *   · 外链 / `data:` / 锚点 / 协议相对 —— 不受影响，不计；
 *   · 根相对（`/a.png`）—— `file://` 下解析到磁盘根，换目录也不变，不计；
 *   · `<a href>` 这类**导航**目标 —— 本页渲染不依赖它，不计（列表里根本没取 `<a>`）。
 *
 * ⚠️ 属性一律走 `getAttribute`，**不能用正则扫源码**：源码里 `data-href="doc-01-s1"`
 * 会被 `href=` 的正则匹配到。我第一版就这么误报了 110 个假依赖（真依赖只有 2 个）。
 */
export function collectSiblingDeps(doc: Document, cap = 6): { names: string[]; more: number } {
  const SEL = [
    'link[rel~="stylesheet"][href]',
    'script[src]',
    'img[src]',
    'source[src]',
    'video[src]',
    'audio[src]',
    'iframe[src]',
    'embed[src]',
    'object[data]',
  ].join(', ');

  // 用 Map 而不是 Set：按**解析后的路径**去重，但显示首次出现的原始写法。
  // 理由：`app.js` 与 `./app.js` 是同一份文件，若各自成条，提示会写成
  // 「依赖 app.js、./app.js」—— 看着像两个文件，恰好稀释掉这条警示的可信度。
  const seen = new Map<string, string>();
  // 只做路径解析用的哑基准（这些 raw 已确认是相对路径，解析一定有定义）。
  // 不用 `doc.location`：`DOMParser` 造出的游离文档是 `about:blank`，相对路径在那儿解析不了。
  const BASE = 'file:///__ep_dep_base__/';

  for (const el of Array.from(doc.querySelectorAll(SEL))) {
    const raw = (el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('data') ?? '').trim();
    if (!raw) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(raw)) continue; // 绝对 / 协议相对，不受移动影响
    if (/[\r\n]/.test(raw)) continue; // 属性里塞了换行 ⇒ 不像一个资源路径，跳过
    const noFrag = (raw.split(/[?#]/)[0] ?? '').trim();
    if (!noFrag) continue;
    let key = noFrag;
    try {
      key = new URL(noFrag, BASE).pathname;
    } catch {
      // 解析不了（极怪的写法）⇒ 拿原文当键，至少不会把两份不同文件并成一条。
    }
    if (!seen.has(key)) seen.set(key, noFrag);
  }

  const all = [...seen.values()];
  return { names: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

/**
 * 取出原文件所在目录，**只用于显示**。
 *
 * FSA 给不到路径（`handle` 上没有这个信息），所以唯一来源是 `location.href` —— 那正是
 * 用户需要知道的那句话：「请存回这个目录」。Windows 习惯用反斜杠，这里顺手转换。
 */
export function directoryOf(href: string): string {
  try {
    const pathname = decodeURIComponent(new URL(href).pathname);
    const i = pathname.lastIndexOf('/');
    const dir = i <= 0 ? pathname : pathname.slice(0, i + 1);
    // `file:///C:/a/b/` 的 pathname 是 `/C:/a/b/` ⇒ 显示成 `C:\a\b\`
    return /^\/[a-zA-Z]:\//.test(dir) ? dir.slice(1).replace(/\//g, '\\') : dir;
  } catch {
    return '';
  }
}

export interface BuildSaveOptions {
  /**
   * 插进 `<head>` 最前面的 `<base href>` 的**值**。
   *
   * P0-9 起这个选项的用途变了：不再用于「另存到子目录时把基准拉回原目录」（那条路线已被
   * 「内联依赖」取代），而是作为**降级兜底** —— 当某个依赖读不到、没被内联时，把解析基准
   * 指回**原目录的绝对 URL**，让那一个漏网的依赖仍能找到。只在这种情况下才传。
   */
  baseHref?: string;
}

/**
 * 克隆一份文档并**在副本上**清理编辑器痕迹（P0-9 起的主线入口）。
 *
 * 为什么把「克隆 + 清理」单独暴露出来：内联依赖必须在 Document 上做（要查询、替换节点），
 * 而它得发生在**清理之后、序列化之前**。旧形态只有 `buildSaveHtml` 一个黑盒
 * （进 Document、出字符串），中间没有插手的位置。
 *
 * ⚠️ 仍然坚持「在副本上清理」而不是「在原页面上清理」：后者会把用户的页面当场改掉
 * （抹掉 contenteditable、删掉 `ep-` class），万一写入失败，用户页面已被动过。
 */
export function cloneForSave(
  doc: Document,
  hostId: string = EPX.ROOT,
): { copy: Document; doctype: string; hadScript: boolean } {
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '';
  // The reusable editor snippet is itself an inline script and is intentionally kept in
  // the saved HTML. It should not trigger the warning about page scripts being serialized.
  const hadScript = Array.from(doc.scripts).some(
    (script) => script.getAttribute('data-easypage-self-editor') !== '1',
  );
  // 重新解析一遍等于同时完成「深拷贝」与「拿到可查询的 Document」两件事。
  // 直接 cloneNode 只能得到 Element —— 而清理与残留检测都要按 Document 走。
  const copy = new DOMParser().parseFromString(`${doctype}${doc.documentElement.outerHTML}`, 'text/html');
  // 宿主是我们唯一挂在 light DOM 的节点（Shadow 内部的内容不会被 outerHTML 序列化，
  // 所以工具条与覆盖层本来就不在字符串里）。这一步之后用户文件里就没有编辑器了。
  copy.getElementById(hostId)?.remove();
  stripEditorArtifacts(copy);
  return { copy, doctype, hadScript };
}

/** 把清理后的副本序列化回字符串（与 `cloneForSave` 成对使用）。 */
export function serializeDocument(copy: Document, doctype: string): string {
  return `${doctype}${copy.documentElement.outerHTML}`;
}

/**
 * 往清理后的副本里插 `<base>`，返回是否插了、以及页面**自己**已有的那个值。
 *
 * 位置必须在 head 的**最前面**：`<base href>` 只影响出现在它**之后**的 URL 属性，
 * 插到中间会让它前面的 `<link rel=stylesheet>` 不被覆盖 —— 那种「一半生效」最难查。
 *
 * 页面自带 base ⇒ **绝不覆盖**。它的语义只有页面自己清楚；而且规范上只有**第一个**
 * 带 href 的 base 作数，我们再插一个也不会生效，改了反而可能弄坏它。
 *
 * 🔴 **P0-9 第七轮（2026-09-23 深夜）起，主线保存路径不再调用它。** 用户裁决改用
 * 「把内联不成的引用逐个改写成绝对 URL」（实现在 `inline-deps.ts`）：兜底 base 会把页面上
 * 所有 `href="#…"` 页内锚点一并解析到原目录的目录 URL ⇒ 用户点导航就跳出副本，随后 Chrome
 * 把导航判成跨 file 源而全拦（`'file:' URLs are treated as unique security origins`）。
 * 保留它只为 `buildSaveHtml`（@deprecated）与存量取证链，**新代码不要再调用**。
 */
export function insertBase(
  copy: Document,
  baseHref?: string,
): { baseInjected: boolean; existingBase: string | null } {
  let baseInjected = false;
  let existingBase: string | null = null;
  if (!baseHref) return { baseInjected, existingBase };
  const own = copy.querySelector('base[href]');
  if (own) {
    existingBase = own.getAttribute('href');
  } else if (copy.head) {
    const b = copy.createElement('base');
    b.setAttribute('href', baseHref);
    copy.head.insertBefore(b, copy.head.firstChild);
    baseInjected = true;
  }
  return { baseInjected, existingBase };
}

/**
 * 生成要写进新文件的 HTML。**纯函数：绝不改动活页面。**
 *
 * @deprecated（P0-9 起主线走 `cloneForSave` → 内联 → `insertBase` → `serializeDocument`）
 * 保留它是因为存量单测与 P0-5/P0-7/P0-8 的取证链都引它，且它的行为被逐条断言过。
 * **新代码不要再加功能到这条路径上** —— 它与主线是同一套克隆/清理逻辑，不会漂移。
 */
export function buildSaveHtml(
  doc: Document,
  hostId: string = EPX.ROOT,
  opts?: BuildSaveOptions,
): {
  html: string;
  residue: string[];
  hadScript: boolean;
  /** 这次真的插进了 `<base>`。 */
  baseInjected: boolean;
  /** 页面**自己**已有的 `<base href>` 值 —— 非 null 时我们不动它，由调用方决定是否提示。 */
  existingBase: string | null;
} {
  const { copy, doctype, hadScript } = cloneForSave(doc, hostId);
  const { baseInjected, existingBase } = insertBase(copy, opts?.baseHref);
  return {
    html: serializeDocument(copy, doctype),
    residue: collectResidue(copy).map((a) => `${a.kind}@${a.detail}`),
    hadScript,
    baseInjected,
    existingBase,
  };
}

/**
 * 页面里「页内跳转」链接的数量（`<a href="#x">`）。
 *
 * 为什么单列一个函数：`<base href="../">` 会把这类链接**一并**解析到 base 目录
 * （实测解析成 `file:///C:/proj/#top` ⇒ 点下去看到的是目录页，不是回到本文档）。
 * 旧版把这算作「base 方案唯一的代价、无法两全」，只如实提示、不修。
 *
 * 🔴 **P0-9 第七轮把这条代价结掉了**：主线不再插 base，改为把内联不成的引用逐个改写成
 * 绝对 URL —— 依赖照旧读得到，页内锚点也不再被拉走。用户正是因为这条代价报的「没法点」。
 * 现在它只用于 `buildSaveHtml`（@deprecated）那条线的取证与单测，主线保存路径不再调用。
 */
export function countFragmentAnchors(doc: Document): number {
  let n = 0;
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    if ((a.getAttribute('href') ?? '').trim().startsWith('#')) n += 1;
  }
  return n;
}

/** 把字符串交给原生保存框写进用户选定的文件。 */
export async function writeBack(
  html: string,
  name: string,
  picker: SavePicker | null,
  onPicked?: (handle: FileHandleLike) => void | Promise<void>,
): Promise<SaveResult> {
  if (!picker) return { outcome: 'unsupported' };
  try {
    const handle = await picker({
      suggestedName: name,
      types: [{ description: '网页文件', accept: { 'text/html': ['.html', '.htm'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(html);
    await writable.close();
    // 写成功之后才记 handle —— 一个写不进去的 handle 记下来只会误导下一次。
    // 记不住不影响本次结果（store.save 自己吞异常）。
    try {
      await onPicked?.(handle);
    } catch {
      /* 记 handle 是优化项，失败不改变「已保存」这个事实 */
    }
    return { outcome: 'saved', detail: handle.name };
  } catch (err) {
    const errName = (err as { name?: string } | null)?.name ?? '';
    // 用户在原生框里点了取消 —— 这是正常操作，不能报成错误弹提示。
    if (errName === 'AbortError') return { outcome: 'cancelled' };
    // 这两个名字意味着「协议/权限层面就没让走」：本环境实际上不支持写回，
    // 与「写入过程失败」是两码事，必须分开上报，否则用户会以为是磁盘问题。
    if (errName === 'SecurityError' || errName === 'NotAllowedError') {
      return { outcome: 'unsupported', detail: errName };
    }
    return { outcome: 'failed', detail: errName || String(err) };
  }
}

/**
 * 直接写进一个**已知的** handle —— 不弹框（P0-7）。
 *
 * 与 `writeBack` 分开写而不是加个分支：两者的失败含义不同。这里失败**不一定是终局**
 * （句柄过期、权限退化都很常见），调用方会退回去让用户重选一次；而 `writeBack` 失败
 * 就是用户看到的最终结果。混在一个函数里会让「该不该退」变得难以判断。
 */
export async function writeDirect(html: string, handle: FileHandleLike): Promise<SaveResult> {
  return writeDirectData(html, handle);
}

/** 原始字节也可直接写回，用于恢复点和保留 UTF-16 编码。 */
export async function writeDirectData(data: string | Uint8Array, handle: FileHandleLike): Promise<SaveResult> {
  try {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return { outcome: 'saved', detail: handle.name, direct: true };
  } catch (err) {
    const errName = (err as { name?: string } | null)?.name ?? '';
    if (errName === 'SecurityError' || errName === 'NotAllowedError') {
      return { outcome: 'unsupported', detail: errName };
    }
    return { outcome: 'failed', detail: errName || String(err) };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 覆盖当前正在编辑的 HTML 原件。
 *
 * 首次保存只允许通过 `showOpenFilePicker` 选择已有文件，避免保存框在错误目录里
 * 创建一个同名新文件。选择结果必须与当前页面文件名完全一致。浏览器不向网页暴露
 * 选中文件的完整路径，因此首次选择后会再展示来源路径并要求用户逐次确认覆盖。
 *
 * `picker` 必须在保存按钮的点击调用栈中传入：没有已记住句柄时，本函数会在第一个
 * `await` 之前启动原生选择器，以保留 Chrome 所需的用户手势。
 */
export async function saveOriginalDocument(
  doc: Document,
  href: string,
  io: {
    picker: OpenFilePicker | null;
    handle?: FileHandleLike | null;
    store?: HandleStore | null;
    confirm?: ConfirmOverwrite;
    /** 编辑开始时捕获的文档；传入后启用源码局部补丁，无法映射时拒绝覆盖。 */
    sourceBaseline?: Document;
    /** 保存成功后更新下一轮局部补丁的基线。 */
    onSaved?: (baseline: Document) => void;
  },
): Promise<SaveResult> {
  // A web URL cannot be overwritten through a local FileSystemFileHandle. Requiring a
  // local file URL also prevents a same-named local file from being mistaken for a hosted page.
  try {
    if (new URL(href).protocol !== 'file:') {
      return {
        outcome: 'unsupported',
        detail: '请在 Chrome 中直接打开本地 HTML 文件（file://）后保存',
      };
    }
  } catch {
    return { outcome: 'unsupported', detail: '当前页面地址不是可覆盖的本地 HTML 文件' };
  }

  const hadScript = Array.from(doc.scripts).some(
    (script) => script.getAttribute('data-easypage-self-editor') !== '1',
  );
  let output: string | Uint8Array = '';
  if (!io.sourceBaseline) {
    const built = buildSaveHtml(doc);
    const blocked = residueBlocker(built.residue);
    if (blocked) return { outcome: 'dirty', detail: blocked, hadScript };
    output = built.html;
  }

  const name = suggestedNameFrom(href);
  let handle = io.handle && looksLikeFileHandle(io.handle) && io.handle.name === name ? io.handle : null;
  let selected = false;

  if (!handle) {
    if (!io.picker) return { outcome: 'unsupported', detail: '浏览器未提供本地文件选择能力', hadScript };

    // 有意先启动选择器，再 await：Chrome 要求文件选择器由用户手势直接触发。
    let pending: Promise<FileHandleLike[]>;
    try {
      pending = io.picker({
        id: 'ep-save-original',
        multiple: false,
        types: [{ description: 'HTML 原件', accept: { 'text/html': ['.html', '.htm'] } }],
      });
    } catch (err) {
      return { outcome: 'failed', detail: (err as { name?: string } | null)?.name ?? String(err), hadScript };
    }

    try {
      const handles = await pending;
      handle = handles[0] ?? null;
      if (!handle) return { outcome: 'cancelled', hadScript };
      selected = true;
    } catch (err) {
      const errName = (err as { name?: string } | null)?.name ?? '';
      if (errName === 'AbortError') return { outcome: 'cancelled', hadScript };
      if (errName === 'SecurityError' || errName === 'NotAllowedError') {
        return { outcome: 'unsupported', detail: errName, hadScript };
      }
      return { outcome: 'failed', detail: errName || String(err), hadScript };
    }
  }

  if (!handle) return { outcome: 'failed', detail: '没有取得原件文件句柄', hadScript };
  if (handle.name !== name) {
    return {
      outcome: 'failed',
      detail: `选中的文件是「${handle.name}」，当前原件应为「${name}」。请重新选择原件。`,
      hadScript,
    };
  }

  if (!(await ensureWritable(handle))) {
    return {
      outcome: 'failed',
      detail: '尚未获得原件写入权限。请再次点击保存，并在 Chrome 提示中允许写入。',
      hadScript,
      // Keep the just-selected handle for this tab. Chrome may require the next
      // explicit Save click to present its write-permission prompt with fresh activation.
      handle,
      forgetHandle: false,
    };
  }

  let backupBytes: Uint8Array | null = null;
  if (io.sourceBaseline) {
    if (typeof handle.getFile !== 'function') {
      return {
        outcome: 'failed',
        detail: 'Chrome 未提供读取原件能力；为避免整页重排，已停止覆盖',
        hadScript,
        handle,
      };
    }
    try {
      backupBytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (err) {
      return {
        outcome: 'failed',
        detail: `读取原件失败，未覆盖：${(err as { name?: string } | null)?.name ?? String(err)}`,
        hadScript,
        handle,
      };
    }
    const decoded = decodeHtmlSource(backupBytes, doc.characterSet);
    if (!decoded.ok) {
      return { outcome: 'dirty', detail: decoded.reason, hadScript, handle };
    }
    const patched = patchHtmlSource(decoded.value.text, io.sourceBaseline, doc);
    if (!patched.ok) {
      return { outcome: 'dirty', detail: patched.reason, hadScript, handle };
    }
    try {
      output = encodeHtmlSource(patched.html, decoded.value.encoding, decoded.value.bom);
    } catch {
      return {
        outcome: 'dirty',
        detail: '编辑内容无法用原文件编码表示，或包含无效 Unicode 字符；请先将 HTML 转为 UTF-8 后再编辑',
        hadScript,
        handle,
      };
    }
  }

  const sourcePath = `${directoryOf(href)}${name}`;
  const scriptNote = hadScript
    ? '\n\n页面含脚本；动态变化只有能可靠映射回原源码时才会写入。'
    : '';
  const message = [
    `即将覆盖当前 HTML 原件：\n${sourcePath}`,
    '请确认文件选择器中选中的是这个位置的原件。Chrome 不会向插件提供所选文件夹路径。',
    io.sourceBaseline
      ? '保存会只替换已编辑的源码片段，并在本机留存当前原件作为恢复点。'
      : '',
    scriptNote,
    '\n确认覆盖吗？',
  ].filter(Boolean).join('\n');

  let confirmed: boolean;
  try {
    confirmed = (io.confirm ?? ((text) => window.confirm(text)))(message);
  } catch (err) {
    return {
      outcome: 'failed',
      detail: `无法显示覆盖确认：${(err as { name?: string } | null)?.name ?? String(err)}`,
      hadScript,
      handle,
    };
  }
  if (!confirmed) {
    return {
      outcome: 'cancelled',
      detail: '用户取消覆盖',
      hadScript,
      handle,
    };
  }

  // The user may leave the confirmation open while another program changes the file.
  // Re-read immediately before backup/write and refuse to overwrite a newer version.
  if (io.sourceBaseline && backupBytes && handle.getFile) {
    try {
      const latestBytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (!sameBytes(backupBytes, latestBytes)) {
        return {
          outcome: 'failed',
          detail: '确认期间原件已被其他程序修改；为避免覆盖新内容，请重新加载页面后再编辑',
          hadScript,
          handle,
        };
      }
    } catch (err) {
      return {
        outcome: 'failed',
        detail: `确认后无法再次读取原件，未覆盖：${(err as { name?: string } | null)?.name ?? String(err)}`,
        hadScript,
        handle,
      };
    }
  }

  // 只有用户确认了所选文件对应来源位置后，才记住新句柄供下一次保存复用。
  if (selected) await io.store?.save(pathKeyOf(href), handle);

  // Backup persistence is required for source-preserving saves. If it fails, keep the original
  // file intact rather than silently proceeding without the promised recovery point.
  let backupAvailable = false;
  if (io.sourceBaseline && backupBytes) {
    backupAvailable = await (io.store?.saveBackup?.(pathKeyOf(href), backupBytes) ?? Promise.resolve(false));
    if (!backupAvailable) {
      return {
        outcome: 'failed',
        detail: '本机恢复备份保存失败，为保护原件已停止覆盖',
        hadScript,
        handle,
      };
    }
  }

  const result = await writeDirectData(output, handle);
  if (result.outcome !== 'saved') {
    const forgetHandle = result.detail === 'SecurityError' || result.detail === 'NotAllowedError';
    if (forgetHandle) await io.store?.remove?.(pathKeyOf(href));
    return {
      ...result,
      hadScript,
      backupAvailable,
      handle: forgetHandle ? undefined : handle,
      forgetHandle,
    };
  }

  await io.store?.save(pathKeyOf(href), handle);
  io.onSaved?.(captureSourceBaseline(doc));
  return { ...result, hadScript, handle, backupAvailable };
}

/** Restore the last exact byte-for-byte pre-save copy kept in this browser. */
export async function restoreOriginalBackup(
  href: string,
  handle: FileHandleLike,
  store: HandleStore,
  confirm: ConfirmOverwrite = (message) => window.confirm(message),
): Promise<SaveResult> {
  const bytes = await store.loadBackup?.(pathKeyOf(href));
  if (!bytes) return { outcome: 'failed', detail: '没有找到本机保存的原件恢复点' };
  if (!(await ensureWritable(handle))) {
    return { outcome: 'failed', detail: '没有获得原件写入权限，请再次操作并允许写入', handle };
  }
  let yes = false;
  try {
    yes = confirm(`将用本机恢复点覆盖当前文件「${handle.name}」。当前页面的未保存编辑也会随重载丢失。\n\n确认恢复吗？`);
  } catch (err) {
    return { outcome: 'failed', detail: `无法显示恢复确认：${(err as { name?: string } | null)?.name ?? String(err)}`, handle };
  }
  if (!yes) return { outcome: 'cancelled', detail: '已取消恢复', handle, backupAvailable: true };
  const result = await writeDirectData(bytes, handle);
  return { ...result, backupAvailable: true, handle };
}

/** 恢复与当前 URL 同名的已记住原件；形状不符或文件名变了就丢弃旧句柄。 */
export async function rememberedFileForSave(
  store: HandleStore,
  href: string,
): Promise<FileHandleLike | null> {
  const key = pathKeyOf(href);
  const raw = await store.load(key);
  if (looksLikeFileHandle(raw) && raw.name === suggestedNameFrom(href)) return raw;
  if (raw !== null) await store.remove?.(key);
  return null;
}

/**
 * 残留判定的对外形态：`null` = 干净可写。
 *
 * 抽成独立函数是为了能单独断言这条**判定**本身 —— 注意它只测判定，不假装测到了
 * 「何时会产生残留」。见 `saveCurrentDocument` 里对绊线的说明。
 */
export function residueBlocker(residue: string[]): string | null {
  return residue.length === 0 ? null : residue.slice(0, 3).join('、');
}

/**
 * ⚠️ **@deprecated（P0-8 起无生产调用方）** —— 保留供参考与单测；新流程请用
 * `dir-save.ts` 的 `saveCopy`。
 *
 * 它实现的是「**就地覆写原文件**」，而产品形态已转过两轮：
 *   就地覆写 → P0-8「另存到 `_改/`」→ **P0-9「另存为同目录的 `原名_改.html`，且自包含」**。
 * 没有删掉的两个理由：① `qa/report/verify-p0-5.md` / `verify-p0-7.md` 的取证链要能对上代码；
 * ② 将来若要加「导出为单个 html」的入口，这里是现成的实现。
 * 但**不要再往里加功能** —— 两条写盘路径并存，会让「保存到底做了什么」变得难解释。
 *
 * 一键闭环：序列化 → 清理自检 → （优先）直接写回上次那个文件 → 否则弹框 → 写入。
 * 残留非空时**不弹框**（不给用户一个「点了保存却什么都没发生」的困惑）。
 *
 * 🔴 P0-7 的关键在 `store`：它让「写回同一份文件」不再依赖用户每次都在原生框里选对位置。
 * 但整条 direct 路径都是**尽力而为** —— handle 取不到、权限不是 granted、写入抛错，
 * 任何一步不成立都静默退回到 P0-5 的弹框流程，结果不会比之前更差。
 *
 * ⚠️ `dirty` 是一条**绊线，不是可达路径**：`stripEditorArtifacts` 与 `collectResidue`
 * 口径同源、逐条对应（contenteditable / data-ep-* / ep- class / 覆盖层 / 注入 style·script
 * 五种，清的与查的一一对应），所以在当前代码下它永远不会亮。
 * 保留它的意义是**给未来加防御**：将来若有人新增一种注入物却只改了 strip 没改 collect
 * （或反过来），这条会立刻拦下写回，而不是把编辑器垃圾写进用户文件。
 * ⇒ 与其编造一个假输入去点亮它，不如把「它为什么不该被点亮」写清楚。
 */
export async function saveCurrentDocument(
  doc: Document,
  href: string,
  picker: SavePicker | null = browserPicker(),
  store: HandleStore | null = null,
): Promise<SaveResult> {
  const built = buildSaveHtml(doc);
  const blocked = residueBlocker(built.residue);
  if (blocked) {
    return { outcome: 'dirty', detail: blocked, hadScript: built.hadScript };
  }

  const name = suggestedNameFrom(href);
  const base = { hadScript: built.hadScript };

  // ① 优先：写回**上次记住的那个文件**。不弹框 ⇒ 也就不存在「位置选错」这件事。
  if (store) {
    // store 原样返回、由这里判形状：库里可能躺着 P0-8 存的**目录**句柄（键前缀不同，
    // 但形状判定要自证），拿它当文件用会在写盘中途炸。
    const raw = await store.load(pathKeyOf(href));
    const known = looksLikeFileHandle(raw) ? raw : null;
    if (known && (await ensureWritable(known))) {
      const direct = await writeDirect(built.html, known);
      if (direct.outcome === 'saved') {
        return { ...direct, ...base, nameMismatch: direct.detail !== name };
      }
      // 没写成功 ⇒ 不在这里下结论。句柄过期／权限退化很常见，退回去让用户重选一次。
    }
  }

  // ② 退回 P0-5：弹框选位置；成功则记下 handle 供下次直接用。
  const result = await writeBack(built.html, name, picker, (h) => store?.save(pathKeyOf(href), h));
  return {
    ...result,
    ...base,
    nameMismatch: result.outcome === 'saved' && result.detail !== name,
  };
}
