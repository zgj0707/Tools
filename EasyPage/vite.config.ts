import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // 纯本地单文件工具：资源相对路径 + 全部内联进一个 index.html，
  // 使产物可直接双击 file:// 打开，无需静态服务器。
  plugins: [viteSingleFile()],
  base: './',
  build: {
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    // 只把单测目录交给 Vitest；e2e 由 Playwright 单独跑，避免重复执行
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
