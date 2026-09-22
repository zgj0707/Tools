import { defineConfig, devices } from '@playwright/test';
import { LAYOUT_OPEN_ALL, LAYOUT_STORAGE_KEY } from './src/app/layout/UiLayout';

const BASE_URL = 'http://localhost:4173';

/**
 * e2e 的统一前置条件：左右面板展开。
 *
 * 方案 C 把「左右面板默认收起」作为产品默认（见 src/app/layout/UiLayout.ts）。
 * 但绝大多数用例的真实意图是「在面板可用时，当我对面板做 X，应当得到 Y」，
 * 而不是「面板默认是收起的」——后者由 tests/e2e/layout.spec.ts 专门覆盖。
 *
 * 因此这里用 storageState 预置持久化偏好，把「面板已展开」声明成全局前置条件：
 * 21 个 spec 里约 157 处依赖元素常驻可见的断言无需逐条改写。
 * 需要用默认收起态跑用例时，用 test.use({ storageState: { cookies: [], origins: [] } }) 退出。
 */
const layoutStorageState = {
  cookies: [],
  origins: [
    {
      origin: BASE_URL,
      // 同时覆盖 localhost / 127.0.0.1，避免 dev server 的 host 归一化差异导致前置条件丢失
      localStorage: [{ name: LAYOUT_STORAGE_KEY, value: LAYOUT_OPEN_ALL }],
    },
    {
      origin: 'http://127.0.0.1:4173',
      localStorage: [{ name: LAYOUT_STORAGE_KEY, value: LAYOUT_OPEN_ALL }],
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
