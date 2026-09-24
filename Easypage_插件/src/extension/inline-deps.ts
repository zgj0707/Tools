// 把本地静态 CSS、脚本、图片等资源内联到副本 HTML，供单文件分享。
// 无法读取的引用会保留或改写为绝对 file:// URL，并进入失败清单；调用方据此说明副本仍依赖原目录。
//
// 覆盖范围：CSS `url()` / `@import`、常见媒体资源、外链脚本、srcset；CSS 导入最多递归 8 层，
// 总依赖原始字节最多 16 MB。`<iframe>` 与运行时 fetch/XHR 不会静态内联。CSS 使用正则扫描，
// 不是完整语法解析器。内联脚本保留属性，并将 defer 脚本移动到 body 末尾以保持执行时序。

export type DepReader = (relPath: string) => Promise<Uint8Array | null>;

export interface InlineFailure {
  /** 文档相对路径，或原始写法（越界时给不出相对路径）。 */
  path: string;
  reason: string;
}

export interface InlineResult {
  /** 成功内联进来的依赖（文档相对路径，去重后）。 */
  inlined: string[];
  /** 没内联成功的依赖 —— **非空即表示这份副本不自包含**。 */
  failures: InlineFailure[];
  /**
   * 因为没能内联、被改写成**绝对 URL** 的引用（写进去的值，去重后）。
   *
   * 与 `failures` 不是一一对应：`failures` 里还包含 `<iframe>`（**刻意不改写**，见文件头）。
   * 分开报是为了让提示不说谎 —— 「已改写成绝对路径」只能对着这里的条数说。
   */
  rebased: string[];
  /** 实际搬进来的原始字节数（不含 base64 膨胀），给体积提示用。 */
  bytes: number;
}

type Resolved =
  | { kind: 'dep'; rel: string }
  | { kind: 'skip'; why: string }
  | { kind: 'outside'; abs: string };

/** 记录静态扫描无法变成内嵌数据的非本地引用，避免把副本误报为完全自包含。 */
function noteUnembedded(raw: string, fail: (path: string, reason: string) => void): void {
  const value = raw.trim();
  if (/^https?:/i.test(value)) {
    let host = '远程资源';
    try {
      host = new URL(value).origin;
    } catch {
      // 用户提示只显示来源，不显示可能包含访问令牌的完整 URL。
    }
    fail(host, '保留远程链接，打开副本时需要网络');
  } else if (/^blob:/i.test(value)) {
    fail('blob URL', '只在当前页面会话有效，无法内联');
  } else if (value && !/^(?:data:|#)/i.test(value)) {
    const protocol = value.match(/^([a-z][a-z\d+.-]*:)/i)?.[1] ?? '此引用';
    fail(protocol, '当前协议不支持内联');
  }
}

const TEXT_EXT = /\.(?:css|js|mjs|json|txt|csv|html?|svg)$/i;

/** 按扩展名给一个 mime。够用即可 —— 只影响 `data:` URI 的前缀。 */
export function mimeOfPath(p: string): string {
  const i = p.lastIndexOf('.');
  const ext = i < 0 ? '' : p.slice(i + 1).toLowerCase();
  const map: Record<string, string> = {
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    html: 'text/html',
    htm: 'text/html',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
  };
  return map[ext] ?? (TEXT_EXT.test(p) ? 'text/plain' : 'application/octet-stream');
}

/** 文档所在目录的绝对 URL（带尾斜杠）：`file:///C:/proj/index.html` → `file:///C:/proj/`。 */
export function dirUrlOf(href: string): string {
  try {
    return new URL('.', href).href;
  } catch {
    return href;
  }
}

/** 文档所在目录的**路径**（正斜杠、带尾斜杠、不带前导斜杠）：→ `C:/proj/`。 */
function dirPathOf(href: string): string {
  try {
    return decodeURIComponent(new URL('.', href).pathname).replace(/^\//, '');
  } catch {
    return '';
  }
}

/**
 * 把一个引用值解析成「相对文档所在目录的路径」。
 *
 * `baseUrl` 是**该引用所在文件**的基准（html 用 `baseHref` 解析后的文档 URL，
 * css 用它自己的文件 URL）—— css 里的相对 `url()` 是相对**那个 css** 解析的，
 * 拿文档当基准会把子目录里的依赖全部找错位置。
 */
export function resolveDepPath(raw: string, baseUrl: string, docDirUrl: string): Resolved {
  const t = (raw ?? '').trim();
  if (!t) return { kind: 'skip', why: '空值' };
  if (/^(?:data:|blob:|#)/i.test(t)) return { kind: 'skip', why: '内联数据、临时 blob 地址或锚点' };
  if (/^https?:/i.test(t)) return { kind: 'skip', why: '远程链接（打开副本时需要网络）' };

  let abs: URL;
  try {
    abs = new URL(t, baseUrl);
  } catch {
    return { kind: 'skip', why: '解析不了' };
  }
  if (abs.protocol !== 'file:') return { kind: 'skip', why: `非本地协议 ${abs.protocol}` };

  const docDir = dirPathOf(docDirUrl);
  const absPath = decodeURIComponent(abs.pathname).replace(/^\//, '');
  if (docDir && !absPath.toLowerCase().startsWith(docDir.toLowerCase())) {
    // 目录句柄读不到上层目录 ⇒ 这类依赖进入失败清单并改写成绝对 URL。
    return { kind: 'outside', abs: absPath };
  }
  const rel = docDir ? absPath.slice(docDir.length) : absPath;
  return rel ? { kind: 'dep', rel } : { kind: 'skip', why: '解析结果为空' };
}

/**
 * 把一个引用原样解析成**绝对 file:// URL**；不是本地引用（或解析不了）时给 null。
 *
 * 只接受 `file:` 结果：`https:` 的引用本来就该保持原样，`data:`/`#` 之类压根不走这条路。
 */
function absUrlOf(raw: string, baseUrl: string): string | null {
  try {
    const u = new URL(raw, baseUrl);
    return u.protocol === 'file:' ? u.href : null;
  } catch {
    return null;
  }
}

const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

/**
 * 把一段 css 里的 `@import` 递归展开、把 `url()` 换成 `data:`。
 *
 * `cssDirUrl` = **这个 css 文件所在目录**的绝对 URL（不是文档的）。
 */
async function inlineCss(
  css: string,
  cssDirUrl: string,
  sourcePath: string,
  ctx: {
    docDirUrl: string;
    load(rel: string): Promise<Uint8Array | null>;
    ok(rel: string, size: number): void;
    canInline(rel: string, size: number): boolean;
    fail(path: string, reason: string): void;
    rebased(abs: string): void;
  },
  depth: number,
): Promise<string> {
  let out = css;

  /**
   * 这条 css 引用内联不成 ⇒ 把它改写成绝对 URL。
   *
   * 🔴 非改不可的理由和 html 侧一样，但更隐蔽：这段 css 最终是作为 `<style>` 进副本的，
   * 而 `<style>` 里的相对 `url()` 是相对**文档**解析的 —— 副本一挪走，它就指向副本自己
   * 所在的那个目录（那里通常什么都没有）。
   */
  const rebase = (whole: string, raw: string, render: (abs: string) => string): void => {
    const abs = absUrlOf(raw, cssDirUrl);
    if (!abs) return;
    ctx.rebased(abs);
    out = out.replace(whole, () => render(abs));
  };

  // ── @import（先做：展开后还要再扫一遍它带来的 url()）──
  const IMPORT_RE =
    /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)|"([^"]*)"|'([^']*)')\s*([^;]*);/gi;
  const imports = [...out.matchAll(IMPORT_RE)].map((m) => ({
    whole: m[0],
    raw: m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '',
    media: (m[6] ?? '').trim(),
  }));
  for (const imp of imports) {
    const r = resolveDepPath(imp.raw, cssDirUrl, ctx.docDirUrl);
    if (r.kind === 'skip') {
      noteUnembedded(imp.raw, ctx.fail);
      continue;
    }
    if (r.kind === 'outside') {
      ctx.fail(imp.raw, `不在所选目录内（${r.abs}）`);
      rebase(imp.whole, imp.raw, (abs) => `@import url("${abs}")${imp.media ? ' ' + imp.media : ''};`);
      continue;
    }
    const bytes = await ctx.load(r.rel);
    if (!bytes) {
      ctx.fail(r.rel, '读不到（文件不存在，或所在目录没有读取权限）');
      rebase(imp.whole, imp.raw, (abs) => `@import url("${abs}")${imp.media ? ' ' + imp.media : ''};`);
      continue;
    }
    if (depth >= 8) {
      ctx.fail(r.rel, `CSS @import 超过 8 层（由 ${sourcePath} 引用）`);
      rebase(imp.whole, imp.raw, (abs) => `@import url("${abs}")${imp.media ? ' ' + imp.media : ''};`);
      continue;
    }
    if (!ctx.canInline(r.rel, bytes.byteLength)) {
      ctx.fail(r.rel, '超出依赖内联体积上限');
      rebase(imp.whole, imp.raw, (abs) => `@import url("${abs}")${imp.media ? ' ' + imp.media : ''};`);
      continue;
    }
    ctx.ok(r.rel, bytes.byteLength);
    const inner = await inlineCss(
      utf8(bytes),
      new URL('.', new URL(r.rel, ctx.docDirUrl)).href,
      r.rel,
      ctx,
      depth + 1,
    );
    out = out.replace(imp.whole, () => (imp.media ? `@media ${imp.media} { ${inner} }` : inner));
  }

  // ── url()（含字体、背景图等）──
  const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi;
  const urls = [...out.matchAll(URL_RE)].map((m) => ({
    whole: m[0],
    raw: m[1] ?? m[2] ?? m[3] ?? '',
  }));
  for (const u of urls) {
    const r = resolveDepPath(u.raw, cssDirUrl, ctx.docDirUrl);
    if (r.kind === 'skip') {
      noteUnembedded(u.raw, ctx.fail);
      continue;
    }
    if (r.kind === 'outside') {
      ctx.fail(u.raw, `不在所选目录内（${r.abs}）`);
      rebase(u.whole, u.raw, (abs) => `url("${abs}")`);
      continue;
    }
    const bytes = await ctx.load(r.rel);
    if (!bytes) {
      ctx.fail(r.rel, '读不到（文件不存在，或所在目录没有读取权限）');
      rebase(u.whole, u.raw, (abs) => `url("${abs}")`);
      continue;
    }
    if (!ctx.canInline(r.rel, bytes.byteLength)) {
      ctx.fail(r.rel, '超出依赖内联体积上限');
      rebase(u.whole, u.raw, (abs) => `url("${abs}")`);
      continue;
    }
    const dataUri = `url("data:${mimeOfPath(r.rel)};base64,${base64Of(bytes)}")`;
    ctx.ok(r.rel, bytes.byteLength);
    out = out.replace(u.whole, () => dataUri);
  }
  return out;
}

/** base64 编码。走 `btoa` 而不是 Node 的 Buffer —— 这段代码跑在页面里。 */
function base64Of(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // 一次 apply 太多参数会爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** `<script>` / `<style>` 是**原始文本元素**：内容里出现结束标签序列会提前截断。 */
const escapeRawText = (s: string, tag: string): string =>
  s.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

/** `srcset` 是「url [descriptor], url [descriptor]」的逗号列表。 */
function parseSrcset(v: string): Array<{ url: string; extra: string }> {
  return v
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const sp = part.indexOf(' ');
      return sp < 0
        ? { url: part, extra: '' }
        : { url: part.slice(0, sp), extra: part.slice(sp) };
    });
}

/**
 * 主入口：在**清理后的副本**上把所有渲染依赖内联进来。
 *
 * 就地修改 `copy`（它是 `cloneForSave` 出来的副本，不是用户的活页面）。
 * 原文档一律不碰 —— 这是全链路的一致纪律。
 */
export async function inlineDependencies(
  copy: Document,
  opts: { href: string; read: DepReader; maxBytes?: number },
): Promise<InlineResult> {
  const { href, read, maxBytes = 16 * 1024 * 1024 } = opts;

  const docDirUrl = dirUrlOf(href);
  const baseAttr = copy.querySelector('base[href]')?.getAttribute('href') ?? null;
  // 页面自带 base ⇒ 内联时**必须遵照**它解析（P0-8 那条「绝不覆盖」原则在这里变成「必须遵照」）。
  const htmlBase = baseAttr ? new URL(baseAttr, href).href : href;

  const cache = new Map<string, Uint8Array | null>();
  const inlined: string[] = [];
  const failures: InlineFailure[] = [];
  const rebased: string[] = [];
  const counted = new Set<string>();
  let bytes = 0;

  const load = async (rel: string): Promise<Uint8Array | null> => {
    if (cache.has(rel)) return cache.get(rel) ?? null;
    let out: Uint8Array | null = null;
    try {
      out = await read(rel);
    } catch {
      out = null; // reader 说不清原因时一律当「读不到」，由调用方记录并改写引用
    }
    cache.set(rel, out);
    return out;
  };
  const ctx = {
    docDirUrl,
    load,
    ok(rel: string, size: number) {
      if (!counted.has(rel)) {
        counted.add(rel);
        inlined.push(rel);
        bytes += size;
      }
    },
    canInline(rel: string, size: number) {
      return counted.has(rel) || bytes + size <= maxBytes;
    },
    fail(path: string, reason: string) {
      if (!failures.some((f) => f.path === path && f.reason === reason)) failures.push({ path, reason });
    },
    rebased(abs: string) {
      if (!rebased.includes(abs)) rebased.push(abs);
    },
  };

  /**
   * 内联不成 ⇒ 把这个元素上的引用改写成绝对 URL。
   *
   * 引用若仍留在相对位置上，副本一挪走就会指向
   * 副本自己所在的目录 —— 那里什么都没有。
   */
  const rebaseAttr = (el: Element, attr: string, raw: string, baseUrl: string): void => {
    const abs = absUrlOf(raw, baseUrl);
    if (!abs) return;
    ctx.rebased(abs);
    el.setAttribute(attr, abs);
  };

  /** 元素上一次要读文件的属性：读成功就把返回值交给 `apply` 消费。 */
  const withDep = async (
    el: Element,
    attr: string,
    apply: (rel: string, bytes: Uint8Array) => void | Promise<void>,
  ): Promise<void> => {
    const raw = el.getAttribute(attr);
    if (!raw) return;
    const r = resolveDepPath(raw, htmlBase, docDirUrl);
    if (r.kind === 'skip') {
      noteUnembedded(raw, ctx.fail);
      return;
    }
    if (r.kind === 'outside') {
      ctx.fail(raw, `不在所选目录内（${r.abs}）`);
      rebaseAttr(el, attr, raw, htmlBase);
      return;
    }
    const got = await load(r.rel);
    if (!got) {
      ctx.fail(r.rel, '读不到（文件不存在，或所在目录没有读取权限）');
      rebaseAttr(el, attr, raw, htmlBase);
      return;
    }
    if (!ctx.canInline(r.rel, got.byteLength)) {
      ctx.fail(r.rel, `超出体积上限（${Math.round(maxBytes / 1024 / 1024)} MB）`);
      rebaseAttr(el, attr, raw, htmlBase);
      return;
    }
    // 先记**父级**、再进 `apply`（apply 里还会内联它的下级依赖）—— 让 `inlined` 的顺序
    // 是「从外往里」，读起来才是用户视角的引用顺序；反过来会变成 `bg.png` 排在 `styles.css` 前。
    ctx.ok(r.rel, got.byteLength);
    await apply(r.rel, got);
  };

  // ① 页内已有的 <style>：里面的 url() 相对**文档**解析
  for (const st of Array.from(copy.querySelectorAll('style'))) {
    const text = st.textContent ?? '';
    if (!text.trim()) continue;
    st.textContent = escapeRawText(await inlineCss(text, htmlBase, '(页面内 style)', ctx, 0), 'style');
  }

  // ② <link rel=stylesheet> → <style>
  for (const link of Array.from(copy.querySelectorAll('link[href]'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase();
    if (!/\bstylesheet\b/.test(rel)) continue;
    await withDep(link, 'href', async (path, got) => {
      const cssDirUrl = new URL('.', new URL(path, docDirUrl)).href;
      let css = await inlineCss(utf8(got), cssDirUrl, path, ctx, 0);
      const media = (link.getAttribute('media') ?? '').trim();
      if (media && media.toLowerCase() !== 'all') css = `@media ${media} { ${css} }`;
      const style = copy.createElement('style');
      style.textContent = escapeRawText(css, 'style');
      link.replaceWith(style);
    });
  }

  // ③ <script src> → <script>（🔴 defer 必须挪到 </body> 前，否则内联后会立即执行）
  for (const sc of Array.from(copy.querySelectorAll('script[src]'))) {
    // 刻意**不往脚本里塞溯源属性**：`data-ep-*` 会被 `stripArtifacts` / `collectResidue`
    // 认成编辑器残留 ⇒ 保存会被自己的护栏拦下（见文件头纪律 1）。
    await withDep(sc, 'src', (_rel, got) => {
      const inline = copy.createElement('script');
      for (const a of Array.from(sc.attributes)) {
        if (a.name.toLowerCase() === 'src') continue; // 留着 src 会同时加载外链，等于没内联
        inline.setAttribute(a.name, a.value);
      }
      inline.textContent = escapeRawText(utf8(got), 'script');
      const wasDeferred = sc.hasAttribute('defer');
      sc.replaceWith(inline);
      // `defer` 对外链脚本是「解析完 DOM 再执行」；内联脚本忽略这个属性、就地立即执行。
      // 所以带 defer 的脚本必须**搬到 body 末尾**才能保住原来的时序。
      if (wasDeferred && copy.body) copy.body.appendChild(inline);
    });
  }

  // ④ 各类 src / poster / data → data: URI
  const SRC_SEL = 'img[src], source[src], track[src], audio[src], video[src], video[poster], embed[src], object[data], input[src]';
  for (const el of Array.from(copy.querySelectorAll(SRC_SEL))) {
    const attr = el.hasAttribute('src') ? 'src' : el.hasAttribute('poster') ? 'poster' : 'data';
    await withDep(el, attr, (path, got) => {
      el.setAttribute(attr, `data:${mimeOfPath(path)};base64,${base64Of(got)}`);
    });
  }
  // srcset（逗号列表，逐个换）
  for (const el of Array.from(copy.querySelectorAll('img[srcset], source[srcset]'))) {
    const raw = el.getAttribute('srcset') ?? '';
    const parts = parseSrcset(raw);
    const out: Array<{ url: string; extra: string }> = [];
    /** 这个 srcset 候选项没内联成 ⇒ 换成绝对 URL（整条 srcset 是重写回去的，不能只改一半）。 */
    const absPart = (p: { url: string; extra: string }) => {
      const abs = absUrlOf(p.url, htmlBase);
      if (!abs) return p;
      ctx.rebased(abs);
      return { url: abs, extra: p.extra };
    };
    for (const p of parts) {
      const r = resolveDepPath(p.url, htmlBase, docDirUrl);
      if (r.kind === 'skip') {
        noteUnembedded(p.url, ctx.fail);
        out.push(p);
        continue;
      }
      if (r.kind === 'outside') {
        ctx.fail(p.url, `不在所选目录内（${r.abs}）`);
        out.push(absPart(p));
        continue;
      }
      const got = await load(r.rel);
      if (!got) {
        ctx.fail(r.rel, '读不到（文件不存在，或所在目录没有读取权限）');
        out.push(absPart(p));
        continue;
      }
      if (!ctx.canInline(r.rel, got.byteLength)) {
        ctx.fail(r.rel, `超出体积上限（${Math.round(maxBytes / 1024 / 1024)} MB）`);
        out.push(absPart(p));
        continue;
      }
      ctx.ok(r.rel, got.byteLength);
      out.push({ url: `data:${mimeOfPath(r.rel)};base64,${base64Of(got)}`, extra: p.extra });
    }
    el.setAttribute('srcset', out.map((o) => `${o.url}${o.extra}`).join(', '));
  }

  // ⑤ <iframe> 不内联，**也刻意不改写** —— 两件事都不是「忘了」：
  //    · 内联 = 把整份子文档搬进来；
  //    · 改写 = 让副本去**帧导航**原目录里的子文档，而跨 file 源的帧导航正是被 Chrome
  //      `unique origins` 拦下的那一类 ⇒ 等于主动制造用户看到的那条报错。
  //    留在原地最坏只是「这一块没内容」，不会连累整页导航。
  for (const fr of Array.from(copy.querySelectorAll('iframe[src]'))) {
    const raw = fr.getAttribute('src') ?? '';
    const r = resolveDepPath(raw, htmlBase, docDirUrl);
    if (r.kind === 'dep') ctx.fail(r.rel, '暂不支持内联 <iframe>（等于搬进整份子文档）');
    else if (r.kind === 'outside') ctx.fail(raw, `不在所选目录内（${r.abs}）`);
    else noteUnembedded(raw, ctx.fail);
  }

  return { inlined, failures, rebased, bytes };
}
