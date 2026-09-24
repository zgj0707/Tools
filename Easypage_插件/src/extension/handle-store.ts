// handle 的持久化（P0-7 建立，P0-8 扩展到目录句柄，P0-9 沿用）。
//
// ── 它解决的两件事 ──
// ① P0-7：让「写回同一份文件」不再每次都靠用户自己挑对位置 —— 位置既然不由用户每次重选，
//    就没有「选错」这回事。
// ② P0-8 起：让「另存为原文件旁边的副本」只有**第一次**需要用户选目录，之后不用再选。
//    这一条比为 P0-7 更要紧：FSA **拿不到目录路径**，`showDirectoryPicker` 也不接受路径，
//    `startIn` 同样不认「这份 html 所在目录」（见 `qa/probes/directory-copy-capability.mjs`
//    与 `save-picker-startin-capability.mjs`），所以「记住上次选的目录」是唯一能让
//    「自动定位到原文件所在处」变顺手的手段。
//
// ── 🔴 三条必须写明的边界 ──
// 1. **这是「尽力而为」，不是必需路径。** 任何一步失败（环境没有 IndexedDB、handle 没被
//    序列化住、权限拿不到）都**静默退回**到弹框流程。退化后功能与没有它时完全一致，
//    不会比现在更差。⇒ 所有函数永不抛。
// 2. **`file://` 下所有本地文件共享同一个 origin**（已实测，见 `qa/probes/file-handle-persistence.mjs`），
//    所以 IndexedDB 里的 handle **必须按文档路径做键**，否则 A 页面会拿到 B 页面的 handle。
// 3. **权限跨会话会退化。** `granted` 通常只在会话内有效；重新打开页面后再用往往变成 `prompt`，
//    需要 `requestPermission()`（要有用户手势）。这不影响正确性 —— 它仍然指向**同一个**位置；
//    只是可能多一次「允许」确认。
//
// ⚠️ 未测定项（不许当前提）：真 handle 能不能在 `file://` 的 IndexedDB 里活下来，
//    目前**没有**自动化证据 —— `file://` 上 OPFS 被拒（SecurityError），拿不到任何 handle 去测
//    序列化往返。要真 handle 只能靠 picker，那是人手门禁。故本模块按「可能失败」写。

/**
 * 任何拿得到权限的句柄都有的部分。
 *
 * 为什么从 `HandleLike` 里拆出来（P0-8）：`FileSystemDirectoryHandle` **没有**
 * `createWritable()` —— 它只有 `getFileHandle` / `getDirectoryHandle`。若沿用原来那个
 * 要求 `createWritable` 的接口，目录句柄就装不进来，`ensureWritable` 也没法复用。
 */
export interface PermLike {
  readonly name: string;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/** handle 的最小结构：只声明我们真正用到的部分。 */
export interface HandleLike extends PermLike {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** 键值后端。抽出来是为了让 handle-store 的**逻辑**能用内存假后端单测。 */
export interface HandleBackend {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export interface HandleStore {
  /**
   * 取这个键上次存下的东西，**原样**返回，不做形状判定；没有 / 不可用 / 出错一律 `null`，永不抛。
   *
   * 为什么不在这里判定（P0-8）：同一个 store 里存着两种**形状互斥**的句柄 ——
   * 文件句柄（旧的写回链路，有 `createWritable`）与目录句柄（P0-9 的另存链路，有
   * `getDirectoryHandle`）。只有调用方知道它要哪一种，store 猜不出来；
   * 而拿错形状去用，报错会发生在**写盘中途**而不是取用时，最难查。
   * （键前缀把两者分开命名空间：目录句柄用 `dir:`，见 `dir-save.ts` 的 `dirKeyOf`。）
   */
  load(pathKey: string): Promise<unknown>;
  /** 记下句柄。失败静默放弃（优化项，不是必需品）。 */
  save(pathKey: string, handle: unknown): Promise<void>;
  /** 清除过期或不匹配的句柄；旧的内存 store 实现可以不提供。 */
  remove?(pathKey: string): Promise<void>;
  /** 保存覆盖前的原始字节；失败返回 false，调用方必须在覆盖前阻断写入。 */
  saveBackup?(pathKey: string, bytes: Uint8Array): Promise<boolean>;
  /** 读取最近一次保存前的原件备份。 */
  loadBackup?(pathKey: string): Promise<Uint8Array | null>;
}

/** 把文档地址归一成稳定的键：去掉 query / hash，保留完整路径。 */
export function pathKeyOf(href: string): string {
  try {
    const u = new URL(href);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    // 非法 URL（极少）—— 退回原文，至少不会把不同的页面混成同一个键。
    return href;
  }
}

/**
 * 这个对象看起来是不是一个可写的文件 handle。
 *
 * 为什么要判：IndexedDB 取回来的可能是任何东西 —— 序列化失败后的空对象、
 * 上面版本留下的旧结构、甚至别的代码写进同一个键的值。**宁可多判一次，
 * 也不要拿一个形状不对的对象去 `createWritable()`**，那会抛在保存中途。
 */
export function looksLikeFileHandle(v: unknown): v is HandleLike {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === 'string' && typeof o.createWritable === 'function';
}

/**
 * 确保这个句柄现在就能写（文件与目录通用）。
 *
 * 顺序有意为之：`queryPermission` 不需要用户手势，先问它；只有它给 `prompt` 时才去
 * `requestPermission`（那一步需要瞬态激活，而保存是由点击触发的，通常还有）。
 * 环境没提供这套 API 时**不阻断** —— 交给后面的真实操作（`createWritable()` /
 * `getDirectoryHandle()`）用真实结果说话。
 */
export async function ensureWritable(handle: PermLike): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') return true;
  try {
    const q = await handle.queryPermission({ mode: 'readwrite' });
    if (q === 'granted') return true;
    if (typeof handle.requestPermission !== 'function') return false;
    const r = await handle.requestPermission({ mode: 'readwrite' });
    return r === 'granted';
  } catch {
    // 权限确认被拒 / 没有瞬态激活 ⇒ 交给上层退回弹框流程。
    return false;
  }
}

/**
 * 确保这个句柄现在就能**读**（2026-09-23 傍晚起副本写入走浏览器下载，
 * 句柄只剩「读依赖字节」一个用途 ⇒ 只读权限就够，不再向用户要写权限）。
 *
 * ⚠️ 授予过 `readwrite` 的老句柄在 `read` 上同样返回 `granted`（readwrite 蕴含 read），
 * 所以升级用户的旧记忆不用迁移。其余语义与 `ensureWritable` 逐字相同。
 */
export async function ensureReadable(handle: PermLike): Promise<boolean> {
  if (typeof handle.queryPermission !== 'function') return true;
  try {
    const q = await handle.queryPermission({ mode: 'read' });
    if (q === 'granted') return true;
    if (typeof handle.requestPermission !== 'function') return false;
    const r = await handle.requestPermission({ mode: 'read' });
    return r === 'granted';
  } catch {
    return false;
  }
}

/**
 * 用给定后端组装一个 handle 存储。
 *
 * `backend === null`（环境没有 IndexedDB）时返回一个**永远退化的实现**，
 * 让调用方不必到处判空 —— 这让「尽力而为」在代码层面是默认行为，而不是需要记得处理的分支。
 */
export function createHandleStore(backend: HandleBackend | null): HandleStore {
  if (!backend) {
    return {
      async load() {
        return null;
      },
      async save() {
        /* 没有后端 —— 静默放弃 */
      },
      async remove() {
        /* 没有后端 —— 静默放弃 */
      },
      async saveBackup() {
        return false;
      },
      async loadBackup() {
        return null;
      },
    };
  }
  return {
    async load(pathKey: string) {
      try {
        return await backend.get(pathKey);
      } catch {
        return null;
      }
    },
    async save(pathKey, handle) {
      try {
        await backend.put(pathKey, handle);
      } catch {
        /* 存不下就存不下 —— 下次弹框而已，不影响写入正确性 */
      }
    },
    async remove(pathKey) {
      try {
        await backend.del(pathKey);
      } catch {
        /* 清不掉旧句柄也不影响本次保存 */
      }
    },
    async saveBackup(pathKey, bytes) {
      try {
        await backend.put(`backup:${pathKey}`, bytes.slice());
        return true;
      } catch {
        return false;
      }
    },
    async loadBackup(pathKey) {
      try {
        const value = await backend.get(`backup:${pathKey}`);
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        return null;
      } catch {
        return null;
      }
    },
  };
}

const DB_NAME = 'easypage';
const STORE_NAME = 'handles';

/**
 * 真实后端：IndexedDB。
 *
 * 已实测（`qa/probes/file-handle-persistence.mjs`）：`file://` 上 IndexedDB 可用、
 * **跨页面保留**（origin 就是 `file://`，所有本地文件共用一个），
 * content script 的隔离世界也能用同一个库。
 * 拿不到 `indexedDB` 时返回 `null`，由 `createHandleStore` 退化成空实现。
 */
export function createIdbBackend(factory: IDBFactory | null = globalThis.indexedDB ?? null): HandleBackend | null {
  if (!factory) return null;

  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // 另一个标签页占着旧版本连接时会走这里 —— 不能让它永远挂着。
      req.onblocked = () => reject(new Error('indexeddb blocked'));
    });

  const withStore = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const req = fn(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };

  return {
    get: (key) => withStore<unknown>('readonly', (s) => s.get(key)),
    put: async (key, value) => {
      await withStore('readwrite', (s) => s.put(value, key));
    },
    del: async (key) => {
      await withStore('readwrite', (s) => s.delete(key));
    },
  };
}
