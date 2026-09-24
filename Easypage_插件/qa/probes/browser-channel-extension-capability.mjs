// 浏览器渠道对 unpacked 扩展的加载能力实测（A/B 对照）。
//
// 为什么必须实测：Chrome 137 起品牌版（Google Chrome stable）**不再接受 `--load-extension`**，
// 该能力只保留在 Chromium / Chrome for Testing / 部分衍生渠道。这条如果只靠记忆断言，
// 后果是「启动器指向系统 Chrome ⇒ 扩展静默不加载 ⇒ 用户以为装好了其实没装」——
// 一个零报错的失败。本项目对这类问题的规矩是：**别靠推理，靠对照实验。**
//
// 同一套 harness（launchPersistentContext + --load-extension + 同一个 file:// fixture）
// 逐个渠道跑，唯一变量是浏览器可执行文件。
//
// 用法：node qa/probes/browser-channel-extension-capability.mjs
//       （需先 npm run build:extension）

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT_DIR = resolve('dist-extension');
const TMP = resolve('test-results/channel-capability');
const FIXTURE = resolve(TMP, 'fixture.html');

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? 'C:\\Users\\Administrator';
const PW_CHROMIUM = `${HOME}\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe`;

const CANDIDATES = [
  { name: 'Playwright Chromium 1243', exe: PW_CHROMIUM },
  { name: '系统 Google Chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { name: '系统 Microsoft Edge', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
];

const FIXTURE_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>channel probe</title></head><body><h1>探针页</h1></body></html>`;

mkdirSync(TMP, { recursive: true });
writeFileSync(FIXTURE, FIXTURE_HTML, 'utf8');

const rows = [];

for (const c of CANDIDATES) {
  const profile = resolve(TMP, `profile-${c.name.replace(/[^\w]/g, '_')}`);
  rmSync(profile, { recursive: true, force: true });

  if (!existsSync(c.exe)) {
    rows.push({ name: c.name, usable: false, injected: null, note: '可执行文件不存在' });
    continue;
  }

  let ctx = null;
  let injected = false;
  let note = '';
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: false, // 扩展必须 headed（门禁 G2 实测）
      executablePath: c.exe,
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1024, height: 700 },
    });

    // 扩展被系统拒绝时 Chrome 会自己弹一个「不受支持的标记」提示并继续开页面，
    // 所以不能只看「浏览器起没起」，必须真的去页面里找宿主节点。
    let page = ctx.pages()[0];
    if (!page) page = await ctx.newPage();
    await page.goto(`file:///${FIXTURE.replace(/\\/g, '/')}`);

    injected = await page
      .waitForSelector('#ep-root', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (injected) {
      const bar = await page.evaluate(() =>
        Boolean(document.getElementById('ep-root')?.shadowRoot?.getElementById('ep-ext-bar')),
      );
      note = bar ? '宿主 + shadow 内工具条均就位' : '宿主在，但工具条缺失';
    } else {
      note = '未注入（该渠道忽略了 --load-extension）';
    }
  } catch (err) {
    note = `启动失败：${String(err).split('\n')[0].slice(0, 90)}`;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }

  rows.push({ name: c.name, usable: true, injected, note });
}

console.log('\n══════════ 浏览器渠道 × unpacked 扩展加载能力 ══════════');
for (const r of rows) {
  const mark = r.injected === true ? '✅ 可注入' : r.injected === false ? '❌ 不注入' : '—  跳过';
  console.log(`${mark}  ${r.name.padEnd(26)} ${r.note}`);
}
console.log(
  '\n结论：只有 ✅ 的渠道能作为「插件载体」。启动器必须指向它，不能指向不支持的渠道 ——' +
    '\n否则扩展静默不加载、零报错，用户会以为装好了。',
);

const anyInjected = rows.some((r) => r.injected === true);
process.exitCode = anyInjected ? 0 : 1;
