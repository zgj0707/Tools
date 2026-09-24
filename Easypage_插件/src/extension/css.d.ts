// Vite 的 `?inline` CSS 导入返回字符串（不产出 CSS 资源文件）。
//
// 为什么需要这个声明：`tsconfig.json` 开了 `"types": []` 且仓库内没有 `vite-env.d.ts`，
// 因此 `*.css?inline` 没有任何类型来源。插件必须把 CSS 作为字符串塞进 Shadow DOM
// （不能靠 <link>，那会走 light DOM 且受目标页面 CSS 影响），所以这里补一条最小声明。
declare module '*.css?inline' {
  const css: string;
  export default css;
}
