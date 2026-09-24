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
    environmentOptions: {
      // 🔴 单测**不该产生任何网络 I/O**。happy-dom 默认会真的去拉 `<link rel="stylesheet">`
      // 与 `<script src>` 指向的资源（夹具里写 `href="styles.css"` 就会触发）。失败后它要往
      // `window.console` 派发错误，而 `DOMParser` 造出的**游离 document 没有 window** ⇒
      // `Cannot read properties of null (reading 'console')`，以 Unhandled Rejection 污染整轮输出。
      //
      // ⚠️ 三件套必须同时给，缺一不可：只写 `disable*FileLoading` 只是把「联网」换成
      // 「派发一个 notSupportedError」——照样崩。`handleDisabledFileLoadingAsSuccess` 才是
      // 让被禁的加载**安静地当成成功**的那一项。
      //
      // 关掉之后 `<link>` / `script[src]` 仍作为带属性的元素存在，这恰好是单测要的那件事：
      // 我们测的是「怎么枚举依赖」，不是浏览器怎么去取样式与脚本。
      //
      // ⚠️ 同一条纪律也管 `<iframe src>`：happy-dom 会真去导航它（网络 I/O）。P0-9 的
      // 「`<iframe>` 不内联、进失败清单」那条单测就踩到了。这个开关能把「真加载」换成
      // 「立刻派发 notSupportedError」，**但换不掉崩溃** —— 派发要往
      // `ownerDocument.defaultView.console` 写，而 `DOMParser` 造出的游离文档 defaultView 是 null。
      // ⇒ 涉及 `<iframe src>` 的用例必须用**带 window 的全局 document** 并自己静音那条预期错误，
      // 见 `tests/unit/extension-inline-deps.test.ts` 里该用例的注释。
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
          disableIframePageLoading: true,
        },
      },
    },
  },
});
