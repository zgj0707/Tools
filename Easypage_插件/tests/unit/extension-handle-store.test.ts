// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createHandleStore,
  createIdbBackend,
  ensureWritable,
  looksLikeFileHandle,
  pathKeyOf,
  type HandleLike,
} from '../../src/extension/handle-store';

/**
 * P0-7 的 handle 持久化：**所有函数永不抛**是这一层的契约 ——
 * 它是「尽力而为」的优化路径，任何一步失败都必须静默退回 P0-5 的弹框流程。
 * 所以这里除了测「能不能用」，同样重要的是测「坏了会怎样」。
 */

/**
 * 一个可写的假 handle。
 *
 * `query` 与 `request` 要能**分别**设定：真实浏览器里「问过之后用户点了允许」的形态是
 * `queryPermission → 'prompt'` 而 `requestPermission → 'granted'`，
 * 若两者恒等就测不出「先问再请求」这条顺序。
 */
function fakeHandle(
  name = 'a.html',
  opts?: { query?: PermissionState; request?: PermissionState; noQuery?: boolean; noRequest?: boolean },
): HandleLike {
  const query = opts?.query ?? 'granted';
  const request = opts?.request ?? query;
  return {
    name,
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    ...(opts?.noQuery ? {} : { queryPermission: async () => query }),
    ...(opts?.noRequest || opts?.noQuery ? {} : { requestPermission: async () => request }),
  } as HandleLike;
}

/**
 * 极简 IndexedDB 替身 —— 只实现 `createIdbBackend` 真正用到的那几样：
 * `open` / `onupgradeneeded` / `onsuccess` / `transaction` / `objectStore` / `close`。
 * 存在的意义是把「后端接线」也纳入断言（store 是否只建一次、连接有没有关掉），
 * 而不只是测外面那层壳。
 */
function fakeIdb(): { factory: IDBFactory; created: string[]; closes: () => number } {
  const created: string[] = [];
  const storeNames = new Set<string>();
  const data = new Map<string, unknown>();
  let closes = 0;

  const req = (result: unknown) => ({ result }) as unknown as IDBRequest;
  const db = {
    objectStoreNames: { contains: (n: string) => storeNames.has(n) },
    createObjectStore: (n: string) => {
      storeNames.add(n);
      created.push(n);
    },
    transaction: () => {
      // 声明成宽松结构而不是直接标 IDBTransaction：被测代码会往它上面挂 `oncomplete`，
      // 而真实 DOM 类型的签名（`(this: IDBTransaction, ev: Event) => any`）与
      // 我们这种「无参回调」不兼容，硬转会触发 TS2352。
      const tx = {
        objectStore: () => ({
          get: (k: string) => req(data.get(k)),
          put: (v: unknown, k: string) => {
            data.set(k, v);
            return req(undefined);
          },
          delete: (k: string) => {
            data.delete(k);
            return req(undefined);
          },
        }),
        oncomplete: undefined as (() => void) | undefined,
      };
      // oncomplete 必须在调用方挂上监听之后才触发 ⇒ 推到微任务里。
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
      return tx as unknown as IDBTransaction;
    },
    close: () => {
      closes += 1;
    },
  };

  const factory = {
    open: () => {
      const request = {
        result: db,
        onupgradeneeded: undefined as (() => void) | undefined,
        onsuccess: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => {
        if (storeNames.size === 0) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return { factory, created, closes: () => closes };
}

describe('pathKeyOf · file:// 下所有文件共享一个 origin，键必须按路径区分', () => {
  it('去掉 query 与 hash，保留完整路径', () => {
    expect(pathKeyOf('file:///C:/a/b.html?v=2#top')).toBe('file:///C:/a/b.html');
  });

  it('不同目录的同名文件得到不同的键（否则 A 页面会拿到 B 页面的 handle）', () => {
    expect(pathKeyOf('file:///C:/a/index.html')).not.toBe(pathKeyOf('file:///D:/b/index.html'));
  });

  it('非法 URL 退回原文 —— 至少不会把不同页面混成同一个键', () => {
    expect(pathKeyOf('not a url')).toBe('not a url');
  });
});

describe('looksLikeFileHandle · 宁可多判一次，也不要拿形状不对的对象去 createWritable', () => {
  it('name 是字符串且有 createWritable ⇒ 认', () => {
    expect(looksLikeFileHandle(fakeHandle())).toBe(true);
  });

  it('null / undefined / 原始值 / 缺件的对象 ⇒ 不认', () => {
    for (const bad of [null, undefined, 0, '', 'a.html', {}, { name: 'a.html' }, { createWritable() {} }]) {
      expect(looksLikeFileHandle(bad)).toBe(false);
    }
  });
});

describe('ensureWritable · 先问（不需手势）再请求（需手势），环境没给这套 API 时不阻断', () => {
  /** 记录两路各被调了几次 —— 「已经是 granted 就不再请求」是这条顺序的实质。 */
  function counting(query: PermissionState, request: PermissionState, opts?: { noRequest?: boolean }) {
    const calls: string[] = [];
    const h = {
      name: 'a.html',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      queryPermission: async () => {
        calls.push('query');
        return query;
      },
      ...(opts?.noRequest
        ? {}
        : {
            requestPermission: async () => {
              calls.push('request');
              return request;
            },
          }),
    } as HandleLike;
    return { h, calls };
  }

  it('granted ⇒ 可写，且**不去请求**（省掉一次本来不必要的权限确认）', async () => {
    const { h, calls } = counting('granted', 'granted');
    expect(await ensureWritable(h)).toBe(true);
    expect(calls).toEqual(['query']);
  });

  it('没有 queryPermission ⇒ 不阻断，交给 createWritable 用真实结果说话', async () => {
    expect(await ensureWritable(fakeHandle('a', { noQuery: true }))).toBe(true);
  });

  it('prompt → 请求得 granted ⇒ 可写，且确实走完了「先问再请求」两步', async () => {
    const { h, calls } = counting('prompt', 'granted');
    expect(await ensureWritable(h)).toBe(true);
    expect(calls).toEqual(['query', 'request']);
  });

  it('prompt → 请求得 denied ⇒ 不可写（由上层退回弹框流程）', async () => {
    const { h, calls } = counting('prompt', 'denied');
    expect(await ensureWritable(h)).toBe(false);
    expect(calls).toEqual(['query', 'request']);
  });

  it('prompt 但没有 requestPermission ⇒ 不可写（问不了就不冒险往下走）', async () => {
    const { h, calls } = counting('prompt', 'granted', { noRequest: true });
    expect(await ensureWritable(h)).toBe(false);
    expect(calls).toEqual(['query']);
  });

  it('queryPermission 抛错 ⇒ 返回 false，**不往外抛**', async () => {
    const h = {
      name: 'a.html',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      queryPermission: async () => {
        throw new Error('boom');
      },
    } as unknown as HandleLike;
    await expect(ensureWritable(h)).resolves.toBe(false);
  });
});

describe('createHandleStore(null) · 让「尽力而为」成为默认行为，而不是需要记得处理的分支', () => {
  it('没有后端时：load 恒 null、save 是 no-op，都不抛', async () => {
    const store = createHandleStore(null);
    await expect(store.load('file:///a.html')).resolves.toBeNull();
    await expect(store.save('file:///a.html', fakeHandle())).resolves.toBeUndefined();
  });
});

describe('createHandleStore · 有后端时的往返与容错', () => {
  it('save 之后 load 取回同一个 handle', async () => {
    const memory = new Map<string, unknown>();
    const store = createHandleStore({
      get: async (k) => memory.get(k),
      put: async (k, v) => void memory.set(k, v),
      del: async (k) => void memory.delete(k),
    });
    const handle = fakeHandle('稿.html');
    await store.save('file:///C:/a/稿.html', handle);
    await expect(store.load('file:///C:/a/稿.html')).resolves.toBe(handle);
  });

  it('🔴 store **原样返回**、不替调用方做形状判定（P0-8 起）', async () => {
    // 同一个键下可能存着文件句柄（旧的写回链路），也可能是目录句柄（另存链路）
    // —— 只有调用方知道它要哪一种。store 若自作主张筛「形状不对」的值，
    // 就会把调用方真正想要的那一种也一并筛掉。判定分别由
    // `looksLikeFileHandle` / `looksLikeDirHandle` 在调用处完成。
    const junk = { name: 'a.html' }; // 缺 createWritable，也缺 getDirectoryHandle
    const store = createHandleStore({
      get: async () => junk,
      put: async () => {},
      del: async () => {},
    });
    await expect(store.load('k')).resolves.toBe(junk);
  });

  it('后端读写抛错 ⇒ 静默吞掉（存不下就下次弹框，不影响写回正确性）', async () => {
    const store = createHandleStore({
      get: async () => {
        throw new Error('idb 挂了');
      },
      put: async () => {
        throw new Error('idb 挂了');
      },
      del: async () => {},
    });
    await expect(store.load('k')).resolves.toBeNull();
    await expect(store.save('k', fakeHandle())).resolves.toBeUndefined();
  });
});

describe('createIdbBackend · 后端接线（用替身把 IndexedDB 的那几根线也纳入断言）', () => {
  it('拿不到 indexedDB ⇒ null（由 createHandleStore 退化成空实现）', () => {
    expect(createIdbBackend(null)).toBeNull();
  });

  it('object store 只建一次，且每次操作后关闭连接（不泄漏）', async () => {
    const idb = fakeIdb();
    const backend = createIdbBackend(idb.factory);
    expect(backend).not.toBeNull();

    const handle = fakeHandle('稿.html');
    await backend!.put('file:///C:/a/稿.html', handle);
    await expect(backend!.get('file:///C:/a/稿.html')).resolves.toBe(handle);
    await backend!.del('file:///C:/a/稿.html');
    await expect(backend!.get('file:///C:/a/稿.html')).resolves.toBeUndefined();

    expect(idb.created).toEqual(['handles']);
    // put / get / del 各开一次连接 ⇒ 至少关过 3 次
    expect(idb.closes()).toBeGreaterThanOrEqual(3);
  });
});
