import { defineConfig } from 'vite';
import manifest from './src/extension/manifest.json';

/**
 * 插件构建 · **唯一入口**（content script）。
 *
 * 历史注（2026-09-23 傍晚）：这里曾是「双 config 双入口」—— 另一半是 background
 * service worker（`bg.ts`）。拆分的理由是 🔴 **Rollup 的 IIFE 格式不支持代码分割**，
 * 「多入口」在 Rollup 眼里就是代码分割（报
 * `UMD and IIFE output formats are not supported for code-splitting builds`）。
 * 当天「保存后打开文件夹」功能被用户裁决删除 ⇒ background 不再有存在理由，
 * 双构建随之并回单构建。**若将来再加第二个 IIFE 入口，必须重新拆 config，
 * 且后续那个必须 `emptyOutDir: false`**（否则会删掉前一次的产物），入口间不共享模块。
 *
 * 三条约束决定了这份配置的形状：
 *   1. 🔴 **MV3 的 content script 不支持 ES module** ⇒ 必须打成 IIFE 单文件。
 *   2. `manifest.json` 必须落到产物根目录。用 `generateBundle` 手动 emit，
 *      不引 `vite-plugin-static-copy` —— 本仓库对外部依赖敏感（`check:licenses` 逐个审）。
 *   3. `minify: false`：content script 注入进用户页面，走查时要能直接读产物定位问题；
 *      体积由探针单独门禁（`07` §7 定 content script ≤160 kB），不靠压缩达标。
 *
 * CSS 不产出资源文件：`app.css` / `tokens.css` / `extension.css` 全走 `?inline`
 * 以字符串形式注入 Shadow DOM（见 src/extension/host.ts）。
 *
 * ⚠️ 产物文件名由 `fileName: () => 'content.js'` 写死，manifest 里也写死同名 ——
 * 改一处必须改另一处，否则扩展加载后**静默失效**（页面毫无反应，最难往构建上想）。
 */
export default defineConfig({
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    target: 'chrome110',
    minify: false,
    // 单文件 IIFE：不拆 chunk，也不产出 CSS 资源
    cssCodeSplit: false,
    lib: {
      entry: 'src/extension/content.ts',
      formats: ['iife'],
      name: 'EasyPage',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
  plugins: [
    {
      name: 'ep-emit-manifest',
      generateBundle(): void {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest.json',
          source: `${JSON.stringify(manifest, null, 2)}\n`,
        });
      },
    },
  ],
});
