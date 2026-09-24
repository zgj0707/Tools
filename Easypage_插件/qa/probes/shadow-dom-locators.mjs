// 探针：Playwright 的选择器能否穿透 open shadow root？
//
// 为什么需要它：`docs/plan/07` §4.2 断言「覆盖层进 Shadow DOM ⇒ Playwright 的选择器
// 默认不穿透 shadow root ⇒ e2e 锚点体系需要改造」。这条结论直接决定 P0 的成本：
//   · 若不穿透 ⇒ 22 个依赖 DOM 锚点的 spec 全要改写选择器；
//   · 若穿透   ⇒ 锚点体系可原样复用，P0 只需新增「加载扩展 + file:// fixture」基座。
// 该判断不能靠印象，必须实测。本探针就是在「与插件同构」的页面上逐种选择器验证。
//
// 用法：node qa/probes/shadow-dom-locators.mjs

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

// 与 src/extension/host.ts 计划的结构同构：宿主 div + open shadow root，
// 覆盖层与工具条都在 shadow 内部（见 07 §4.2）。
const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>shadow probe</title></head>
<body>
  <h1 id="page-title">宿主页面标题</h1>
  <div id="ep-root"></div>
  <script>
    const root = document.getElementById('ep-root').attachShadow({ mode: 'open' });
    root.innerHTML = \`
      <style>.ep-bar{height:40px}</style>
      <div class="ep-toolstrip" id="ep-toolstrip">
        <button id="ep-btn-bold" aria-label="加粗">加粗</button>
        <button id="ep-btn-copy" title="复制元素">复制元素</button>
        <span class="ep-ctxbar__hint" title="h2">h2</span>
      </div>
      <div class="ep-overlay" id="ep-selected-box" data-dir="se"></div>
    \`;
  </script>
</body></html>`;

const results = [];
function check(name, fn) {
  return fn().then(
    (v) => results.push({ name, ok: true, detail: String(v) }),
    (e) => results.push({ name, ok: false, detail: String(e).split('\n')[0].slice(0, 160) }),
  );
}

mkdirSync('test-results/capability', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(PAGE);

await check('css= #id 穿透', async () => `count=${await page.locator('css=#ep-btn-bold').count()}`);
await check('css= .class 穿透', async () => `count=${await page.locator('.ep-toolstrip').count()}`);
await check('css= 属性选择器 [data-dir] 穿透', async () =>
  `count=${await page.locator('[data-dir="se"]').count()}`);
await check('css= 后代组合 .ep-toolstrip button 穿透', async () =>
  `count=${await page.locator('.ep-toolstrip button').count()}`);
await check('getByRole(button, {name}) 穿透', async () =>
  `count=${await page.getByRole('button', { name: '加粗' }).count()}`);
await check('getByRole(name, {exact:true}) 穿透', async () =>
  `count=${await page.getByRole('button', { name: '加粗', exact: true }).count()}`);
await check('getByText 穿透', async () => `count=${await page.getByText('复制元素').count()}`);
await check('getByTitle 穿透', async () => `count=${await page.getByTitle('复制元素').count()}`);
await check('click() 可交互', async () => {
  await page.locator('#ep-btn-bold').click();
  return 'clicked without error';
});
await check('boundingBox() 可量测（几何断言能否复用）', async () => {
  const b = await page.locator('#ep-selected-box').boundingBox();
  return JSON.stringify(b);
});
await check('evaluate 能否从页面侧拿到 shadow 内元素', async () =>
  `found=${await page.evaluate(() => !!document.getElementById('ep-root').shadowRoot.querySelector('#ep-btn-bold'))}`);

// 反例组：应失败的定位方式（XPath 历来不穿透 shadow DOM）
await check('【反例】xpath 穿透', async () => `count=${await page.locator('xpath=//*[@id="ep-btn-bold"]').count()}`);
await check('【反例】light DOM 里查 shadow 内节点', async () =>
  `count=${await page.locator('body > #ep-btn-bold').count()}`);

await browser.close();

const report = { generatedAt: new Date().toISOString(), results };
writeFileSync('test-results/capability/shadow-dom-locators.json', JSON.stringify(report, null, 2));

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  ${r.detail}`);
}
const pierced = results.filter((r) => r.ok && !r.name.startsWith('【反例】'));
const broken = results.filter((r) => !r.ok || r.name.startsWith('【反例】'));
console.log(`\n可用定位方式 ${pierced.length} 项 · 不可用 ${broken.length} 项`);
