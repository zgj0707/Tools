// 另存副本：优先写入源 HTML 同目录的 `原名_改.html`；目录不可写时回退到浏览器下载。
// 目录句柄首次由保存按钮取得并存进 IndexedDB，后续保存先检查 readwrite 权限。
// 下载回退复用同一份已内联依赖的 HTML；内联失败时逐项提示，不把不完整副本说成可分享。

import { collectResidue } from '../core/serialize/stripArtifacts';
import { ensureReadable, ensureWritable, pathKeyOf, type HandleStore, type PermLike } from './handle-store';
import { inlineDependencies, type DepReader, type InlineFailure } from './inline-deps';
import {
  cloneForSave,
  residueBlocker,
  serializeDocument,
  suggestedNameFrom,
  type SaveResult,
} from './save';

/** 另存出来的文件在原文件名上追加的后缀。 */
export const COPY_SUFFIX = '_改';

/** 目录句柄的最小结构。 */
export interface DirHandleLike extends PermLike {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileEntryLike>;
}

/** 目录里的一个文件项。 */
export interface FileEntryLike extends PermLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable?(): Promise<WritableFileLike>;
}

export interface WritableFileLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export type DirPicker = (opts?: {
  mode?: 'read' | 'readwrite';
  id?: string;
  startIn?: unknown;
}) => Promise<DirHandleLike>;

/** 当前环境的目录选择器；不支持时保存会回退到浏览器下载。 */
export function browserDirPicker(): DirPicker | null {
  const fn = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

/**
 * **文档级**键（P0-9 的原始形态）：`dir:file:///C:/proj/a.html`。
 *
 * 现在只用于**读取**一次升级前的旧值（写着不再用它，见 `dirScopeKeyOf`）。
 * 保留它的理由：升级前用户已经选过目录的那些文件，不该因为键换了粒度而被要求再选一次。
 */
export function dirKeyOf(href: string): string {
  return `dir:${pathKeyOf(href)}`;
}

/**
 * **目录级**键：`file:///C:/proj/a.html` → `dir:file:///C:/proj/`。
 *
 * 「一个目录只问一次」的全部实现：同目录的 `a.html` / `b.html` 要读依赖的**就是
 * 同一个文件夹**。键里带完整目录路径，`file://` 下所有本地文件共用一个 origin 也无妨。
 */
export function dirScopeKeyOf(href: string): string {
  const full = pathKeyOf(href);
  const i = full.lastIndexOf('/');
  return `dir:${i > 0 ? full.slice(0, i + 1) : full}`;
}

/** 最近成功选择的目录句柄键。 */
export const RECENT_DIR_KEY = 'dir:__recent__';

/** 只从当前文档目录的键恢复句柄；不在页面初始化时申请权限，权限请求留给保存按钮点击。 */
export async function rememberedDirectoryForSave(
  store: HandleStore | null,
  href: string,
): Promise<DirHandleLike | null> {
  if (!store) return null;
  for (const key of [dirScopeKeyOf(href), dirKeyOf(href)]) {
    const raw = await store.load(key);
    const candidate = isDirMemory(raw) ? raw.h : looksLikeDirHandle(raw) ? raw : null;
    if (candidate) return candidate;
  }
  return null;
}

export interface SaveDirectoryAccess {
  dir: DirHandleLike | null;
  writable: boolean;
  readable: boolean;
  selected: boolean;
  cancelled: boolean;
  error?: string;
}

/** 在保存按钮点击栈中调用，立即启动权限检查或首次目录选择。 */
export function beginSaveDirectoryAccess(
  remembered: DirHandleLike | null,
  picker: DirPicker | null,
): Promise<SaveDirectoryAccess> {
  const resolveAccess = async (dir: DirHandleLike, selected: boolean): Promise<SaveDirectoryAccess> => {
    const writable = await ensureWritable(dir);
    const readable = await ensureReadable(dir);
    const error = !readable
      ? '没有获得源文件夹的读取权限'
      : !writable
        ? '没有获得源文件夹的写入权限'
        : undefined;
    return { dir, writable, readable, selected, cancelled: false, error };
  };

  if (remembered) return resolveAccess(remembered, false);
  if (!picker) {
    return Promise.resolve({ dir: null, writable: false, readable: false, selected: false, cancelled: false });
  }

  try {
    // 直接调用，不延迟到 Promise 微任务；showDirectoryPicker 需要用户手势。
    return picker({ mode: 'readwrite', id: 'ep-save-dir' })
      .then((dir) => resolveAccess(dir, true))
      .catch((err) => ({
        dir: null,
        writable: false,
        readable: false,
        selected: false,
        cancelled: errNameOf(err) === 'AbortError',
        error: errNameOf(err) || String(err),
      }));
  } catch (err) {
    return Promise.resolve({
      dir: null,
      writable: false,
      readable: false,
      selected: false,
      cancelled: errNameOf(err) === 'AbortError',
      error: errNameOf(err) || String(err),
    });
  }
}

/**
 * 这个对象看起来是不是一个目录句柄。
 *
 * 与 `looksLikeFileHandle` 分开判而不是合成一个：两者形状互斥（一个有 `getDirectoryHandle`、
 * 一个有 `createWritable`），合判会让「取回的是文件句柄」这种错值蒙混过关。
 */
export function looksLikeDirHandle(v: unknown): v is DirHandleLike {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.getDirectoryHandle === 'function' &&
    typeof o.getFileHandle === 'function'
  );
}

/**
 * 上午版（FSA 写入时代）目录级记忆的**信封**形状。
 *
 * 现在只用于**读取兼容**：那个时代的库里存的是 `{h, ok}` 而不是裸句柄，
 * 不解包的话升级用户会被要求重选一次目录。**不再写**这种形状（写回一律裸句柄）。
 */
export interface DirMemory {
  h: DirHandleLike;
  ok: boolean;
}

/** 信封长这样才算信封（句柄本身的形状由 `looksLikeDirHandle` 另判）。 */
export function isDirMemory(v: unknown): v is DirMemory {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return 'h' in o && typeof o.ok === 'boolean';
}

/**
 * 由原文件名算出另存名：`index.html` → `index_改.html`，`a.b.html` → `a.b_改.html`，
 * `readme` → `readme_改`。点在最前面（`.hidden`）当作无扩展名，避免切出空 stem。
 */
export function copyNameOf(base: string): string {
  const i = base.lastIndexOf('.');
  const hasExt = i > 0;
  const stem = hasExt ? base.slice(0, i) : base;
  const ext = hasExt ? base.slice(i) : '';
  return `${stem}${COPY_SUFFIX}${ext}`;
}

const errNameOf = (err: unknown): string => (err as { name?: string } | null)?.name ?? '';

/** 这个目录里有没有这个名字的文件。只回报，不抛。 */
async function hasFile(dir: DirHandleLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * 用目录句柄读依赖字节。**读不到一律返回 null，永不抛** —— 调用方据此进失败清单。
 *
 * ⚠️ 只能读**该目录的下层**（`..` 一律拒绝）：目录句柄不给你越级到上层目录。
 * 这类依赖会以「不在所选目录内」进失败清单，由 `inline-deps` 在失败时改写成绝对 URL。
 */
export function dirReader(dir: DirHandleLike): DepReader {
  return async (rel: string) => {
    const parts = rel.split('/').filter((s) => s && s !== '.');
    if (!parts.length || parts.includes('..')) return null;
    // 🔴 整段都要包住，**包括 `getFileHandle` 与 `getFile`**：文件不存在、中间某一级目录不存在、
    //    没有读取权限，三者在真实目录句柄上抛的都是 `NotFoundError` / `NotAllowedError`。
    try {
      let cur = dir;
      for (const seg of parts.slice(0, -1)) {
        cur = await cur.getDirectoryHandle(seg, { create: false });
      }
      const last = parts[parts.length - 1];
      if (!last) return null;
      const entry = await cur.getFileHandle(last, { create: false });
      const file = await entry.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  };
}

export interface CopySaveResult extends SaveResult {
  /** 副本文件名（`原名_改.html`）。 */
  fileName?: string;
  /** 副本的实际保存目标。 */
  via?: 'source-directory' | 'download';
  /** 最近一次验证通过的目录句柄。 */
  directory?: DirHandleLike | null;
  /** 成功内联进来的依赖（文档相对路径）。 */
  inlined?: string[];
  /** 没内联成功的依赖（非空即表示这份副本**不自包含**）。 */
  failedDeps?: InlineFailure[];
  /** 没能内联、因而改写成绝对 file:// URL 的引用。 */
  rebased?: string[];
  /** 当前文档记住的目录里没有同名源 HTML。 */
  noDir?: boolean;
  memoryRejected?: boolean;
  /** 同目录写入失败或目录选择无效的原因；已尝试下载回退。 */
  directoryIssue?: string;
}

export interface CopyIO {
  /** 目录选择器；首次保存使用 readwrite 模式选源文件目录。 */
  dirPicker: DirPicker | null;
  /** 目录句柄的持久化位置（IndexedDB）。 */
  store: HandleStore | null;
  /** 页面初始化时从当前文档目录键恢复的句柄。 */
  knownDirectory?: DirHandleLike | null;
}

/**
 * 一键闭环：克隆清理 → 取得/恢复源目录 → 内联可读依赖 → 优先写同目录副本 → 失败时下载。
 * 原 HTML 永不改动。首次保存会由用户选择源文件所在目录。
 *
 * @returns `saved` = 同目录副本已写入，或回退副本已交给浏览器下载；`dirty` = 页面有注入残留。
 */
export async function saveCopy(doc: Document, href: string, io: CopyIO): Promise<CopySaveResult> {
  // ── ① 克隆 + 清理（在副本上做，活页面一概不碰）──
  const { copy, doctype, hadScript } = cloneForSave(doc);
  const blocked = residueBlocker(collectResidue(copy).map((a) => `${a.kind}@${a.detail}`));
  if (blocked) return { outcome: 'dirty', detail: blocked, hadScript };

  const originalName = suggestedNameFrom(href);
  const fileName = copyNameOf(originalName);

  // 首次目录选择或 readwrite 权限检查在第一次 await 前启动，保留保存按钮的用户手势。
  const accessPromise = beginSaveDirectoryAccess(io.knownDirectory ?? null, io.dirPicker);
  const access = await accessPromise;
  let dir = access.dir;
  let memoryRejected = false;
  let directoryIssue = access.cancelled ? undefined : access.error;
  if (dir) {
    if (!access.readable) {
      dir = null;
    } else if (!(await hasFile(dir, originalName))) {
      memoryRejected = !access.selected;
      directoryIssue = access.selected ? `所选文件夹中找不到 ${originalName}` : undefined;
      dir = null;
    } else {
      await rememberDir(io.store, dir, href, true);
    }
  }

  // ── 内联依赖。没有可读目录时仍保留下载回退，失败资源会在结果里列明。──
  const inline = dir
    ? await inlineDependencies(copy, { href, read: dirReader(dir) })
    : await inlineDependencies(copy, {
        href,
        read: () => Promise.resolve(null),
      });

  const html = serializeDocument(copy, doctype);

  // ── 优先写到源文件夹的固定副本名；重复保存更新同一个 `_改` 文件。──
  if (dir && access.writable) {
    try {
      await writeSiblingCopy(dir, fileName, html);
      return {
        outcome: 'saved',
        detail: fileName,
        hadScript,
        fileName,
        via: 'source-directory',
        directory: dir,
        inlined: inline.inlined,
        failedDeps: inline.failures,
        rebased: inline.rebased,
        memoryRejected,
      };
    } catch (err) {
      directoryIssue = errNameOf(err) || String(err);
    }
  } else if (dir && !access.writable) {
    directoryIssue = access.error ?? '没有获得源文件夹的写入权限';
  }

  // ── 同目录写入不可用时回退下载同一份 HTML。──
  try {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (err) {
    return { outcome: 'failed', detail: errNameOf(err) || String(err), hadScript };
  }

  return {
    outcome: 'saved',
    detail: fileName,
    hadScript,
    fileName,
    via: 'download',
    directory: dir,
    inlined: inline.inlined,
    failedDeps: inline.failures,
    rebased: inline.rebased,
    noDir: !dir,
    memoryRejected,
    directoryIssue,
  };
}

async function writeSiblingCopy(dir: DirHandleLike, name: string, html: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  if (!handle.createWritable) throw new Error('当前浏览器不支持文件写入');
  const writable = await handle.createWritable();
  try {
    await writable.write(html);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort?.();
    } catch {
      // 保留原始写入错误。
    }
    throw err;
  }

  // 只有写入关闭且读回内容完全一致，才向用户报告同目录保存成功。
  const actual = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  const expected = new TextEncoder().encode(html);
  if (actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i])) {
    throw new Error('写入后校验不一致');
  }
}

export interface InlineDepsResult {
  /** 成功内联进来的依赖（文档相对路径）。 */
  inlined: string[];
  /** 没内联成功的依赖（非空即表示这份副本**不自包含**）。 */
  failedDeps: InlineFailure[];
  /** 这次新选择并记住了目录。 */
  rememberedDir?: boolean;
  /** 记住的目录中未找到当前源 HTML。 */
  memoryRejected?: boolean;
  /** 已验证并记住的目录句柄。 */
  directory?: DirHandleLike;
  /** 用户取消了目录框（或环境不支持）⇒ 没拿到句柄。 */
  cancelled?: boolean;
  /** 选择的目录不包含当前源 HTML，不能作为保存目录。 */
  directoryIssue?: string;
}

/**
 * 「保存目录」动作：预先选择并记住当前源 HTML 文件夹。
 *
 * 保存按钮也会在首次保存时自动选择目录；此入口方便用户提前设置或重新指定。
 *
 * 弹框之前由调用方说明将要选择源文件目录。
 * 取消 / 环境不支持 ⇒ 返回 `cancelled`，不记忆目录；后续保存可回退到下载。
 */
export async function inlineDepsForSave(
  doc: Document,
  href: string,
  io: CopyIO,
): Promise<InlineDepsResult> {
  const originalName = suggestedNameFrom(href);
  if (!io.dirPicker) {
    return { inlined: [], failedDeps: [], directoryIssue: '当前浏览器不支持选择文件夹' };
  }

  // 必须在按钮点击的同步调用栈里立即打开选择器；IndexedDB 查询或权限检查会消耗用户激活。
  let picked: DirHandleLike | null = null;
  try {
    picked = await io.dirPicker({ mode: 'readwrite', id: 'ep-save-dir' });
  } catch (err) {
    if (errNameOf(err) === 'AbortError') return { inlined: [], failedDeps: [], cancelled: true };
    return {
      inlined: [],
      failedDeps: [],
      directoryIssue: errNameOf(err) || String(err),
    };
  }

  if (!(await hasFile(picked, originalName))) {
    return {
      inlined: [],
      failedDeps: [],
      directoryIssue: `所选文件夹中找不到 ${originalName}`,
    };
  }

  // 拿到句柄后按当前文档目录记忆，并检查可内联的资源。
  await rememberDir(io.store, picked, href, true);
  const copy = cloneForSave(doc).copy;
  const inline = await inlineDependencies(copy, { href, read: dirReader(picked) });
  return {
    inlined: inline.inlined,
    failedDeps: inline.failures,
    rememberedDir: true,
    directory: picked,
  };
}

/**
 * 记下这次保存用的目录。**只在真的拿到句柄之后调**。
 *
 *   · 目录级键让同目录的文档复用这个目录句柄。
 *   · 最近键保留最后一次选择，供后续目录操作恢复。
 */
async function rememberDir(
  store: HandleStore | null,
  dir: DirHandleLike | null,
  href: string,
  scope: boolean,
): Promise<void> {
  if (!store || !dir) return;
  if (scope) await store.save(dirScopeKeyOf(href), dir);
  await store.save(RECENT_DIR_KEY, dir);
}
