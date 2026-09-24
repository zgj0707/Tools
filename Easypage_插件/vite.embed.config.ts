import { defineConfig } from 'vite';

/**
 * 可嵌入 HTML 的单文件编辑器构建。
 *
 * 沿用扩展 content script 的入口，因此编辑、格式、撤销/重做、保存语义完全共用；
 * 样式已由 host.ts 作为字符串注入 Shadow DOM，不会产生外置 CSS 或运行时依赖。
 */
export default defineConfig({
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    target: 'chrome110',
    minify: 'esbuild',
    cssCodeSplit: false,
    lib: {
      entry: 'src/extension/content.ts',
      formats: ['iife'],
      name: 'EasyPageSelfEditor',
      fileName: () => 'easypage-self-editor.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
});
