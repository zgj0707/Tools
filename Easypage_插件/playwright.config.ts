import { defineConfig, devices } from '@playwright/test';
import { LAYOUT_OPEN_ALL, LAYOUT_STORAGE_KEY } from './src/app/layout/UiLayout';
import { VIEW_E2E_PRESET, VIEW_STORAGE_KEY } from './src/app/ui/ViewPrefs';

const BASE_URL = 'http://localhost:4173';

/**
 * e2e 的统一前置条件：左右面板展开 + 视图偏好钉死。
 *
 * 方案 C 把「左右面板默认收起」作为产品默认（见 src/app/layout/UiLayout.ts）。
 * 但绝大多数用例的真实意图是「在面板可用时，当我对面板做 X，应当得到 Y」，
 * 而不是「面板默认是收起的」——后者由 tests/e2e/layout.spec.ts 专门覆盖。
 *
 * 因此这里用 storageState 预置持久化偏好，把「面板已展开」声明成全局前置条件：
 * 21 个 spec 里约 157 处依赖元素常驻可见的断言无需逐条改写。
 * 需要用默认收起态跑用例时，用 test.use({ storageState: { cookies: [], origins: [] } }) 退出。
 *
 * 批次 1 追加第二项前置：视图偏好（ViewPrefs）钉死为 autoFit=false + 属性三组全展开。
 * 理由同上一段——用例的真实意图不是「画布初始缩放比是多少」，而是几何与字段语义。
 *   ① autoFit=false ⇒ 缩放恒为 1 ⇒ 画布几何与改造前逐像素一致，
 *      20+ 处基于 clientX/offsetWidth 的坐标断言、命中率断言不受缩放影响；
 *   ② 三组全展开 ⇒ `.ep-box` / `.ep-deco` 字段常驻可交互，
 *      依赖 `nth(i)` 与可见性的断言无需逐条改写。
 * 「默认自动适应」「默认收起哪几组」由 tests/e2e/ui-refactor-batch1.spec.ts 专门覆盖。
 */
const viewPrefsEntry = { name: VIEW_STORAGE_KEY, value: VIEW_E2E_PRESET };

const layoutStorageState = {
  cookies: [],
  origins: [
    {
      origin: BASE_URL,
      // 同时覆盖 localhost / 127.0.0.1，避免 dev server 的 host 归一化差异导致前置条件丢失
      localStorage: [
        { name: LAYOUT_STORAGE_KEY, value: LAYOUT_OPEN_ALL },
        viewPrefsEntry,
      ],
    },
    {
      origin: 'http://127.0.0.1:4173',
      localStorage: [
        { name: LAYOUT_STORAGE_KEY, value: LAYOUT_OPEN_ALL },
        viewPrefsEntry,
      ],
    },
  ],
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    storageState: layoutStorageState,
  },
  // 用 dev server 启动应用，e2e 不依赖先执行 build
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
