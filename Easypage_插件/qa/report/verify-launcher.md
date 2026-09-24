# 启动器（`scripts/open-with-easypage.mjs`）实测记录

> **为什么有这份记录**：用户要求「由 AI 完成插件安装」而非自己手点 `chrome://extensions`。
> 实测过程中出现一个**反直觉且静默**的失败（系统 Chrome 153 完全不认 `--load-extension`，
> 浏览器照常打开、页面照常显示、零报错，只是插件不在），因此把渠道能力与启动器行为
> 一并归档，作为「用户怎么装」这条结论的唯一信源。

## 一、渠道能力 A/B 实测

探针：`qa/probes/browser-channel-extension-capability.mjs`
同一 harness（`launchPersistentContext` + `--load-extension=<dir>` + 同一 `file://` fixture + 同一判定脚本），
**唯一变量是 `executablePath`**。

| 渠道 | 版本 | 注入 | 判定依据 |
|---|---|---|---|
| Playwright 自带 Chromium | 1243 | ✅ | 宿主 `#ep-root` + shadow 内工具条均就位 |
| 系统 Google Chrome | 153.0.8010.48 | ❌ | 未注入（静默忽略 `--load-extension`） |
| 系统 Microsoft Edge | 当前稳定版 | ✅ | 宿主 + shadow 内工具条均就位 |

**定论**：Chrome 137 起，品牌版 Google Chrome 不再接受 `--load-extension`（该能力只保留在
Chromium / Chrome for Testing / Edge 这类渠道）。**失败方式为静默**，因此
「扩展装没装上」不得靠「浏览器起来了」推断，必须去页面里找 `#ep-root`。

## 二、启动器行为实测

### `--dry-run`（不启动浏览器）

```
$ node scripts/open-with-easypage.mjs qa/fixtures/demo-page.html --dry-run
[dry-run] 浏览器: C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
[dry-run] 依据:   系统 Edge（Chromium 内核，已实测可注入）
[dry-run] 探测:   系统 Chrome 153 已忽略 --load-extension（Chrome 137+ 起不再支持），跳过
[dry-run] 探测:   系统 Edge（Chromium 内核，已实测可注入）
[dry-run] 扩展:   ...\dist-extension
[dry-run] 配置:   C:\Users\Administrator\AppData\Local\EasyPage\browser-profile
```

### 强制指定 Chrome 时的预警（防静默失败）

```
$ node scripts/open-with-easypage.mjs --dry-run --browser "...\Google\Chrome\Application\chrome.exe"
[!] 警告：该 Chrome 主版本 153 > 136，实测会静默忽略 --load-extension。
    现象是「浏览器正常打开、页面正常显示，但页面上没有工具条」，且零报错。
    建议：去掉 --browser 让脚本自动挑（Edge / Playwright Chromium 均已实测可注入）。
```

### `--verify`（端到端自证）

```
$ node scripts/open-with-easypage.mjs qa/fixtures/demo-page.html --verify
[i] 浏览器: C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
[i] 依据:   系统 Edge（Chromium 内核，已实测可注入）
[i] 打开:   ...\qa\fixtures\demo-page.html
[✓] 已验证：扩展注入成功，工具条在页面上。
    file:///C:/Users/Administrator/Doubao/chats/2026-09-20/new-chat/qa/fixtures/demo-page.html
    工具条 223×34
```

机制：追加 `--remote-debugging-port=9333` → `chromium.connectOverCDP` 连上去 →
轮询 `#ep-root` 与工具条尺寸 → 把「静默不加载」变成明确结论。

## 三、门禁复验（确认本轮改动未影响既有回归网）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 + 静态检查 + 单测 + 构建 + 许可证 | `npm run check` | **通过**（`dist/index.html 135.44 kB │ gzip: 39.08 kB`；licenses 扫描 328 包 → PASS） |
| 端到端（串行） | `npx playwright test --workers=1` | **84 passed**（1.3m） |

被测树 = 本轮改动的工作区（`scripts/**` 新增、`qa/**` 新增、`qa/probes/extension-p0-1.mjs` 加
`EP_PROBE_BROWSER`、`.gitignore`、`docs/plan/07`）。这些改动**均不在 `tests/e2e/**` 的依赖路径上**，
84 passed 与基线一致。

### 另：P0-1 探针在 Edge 载体下全量复跑

`EP_PROBE_BROWSER=<msedge.exe> node qa/probes/extension-p0-1.mjs` → **17/17 PASS**。

## 四、演示页取证

`qa/probes/extension-demo-shot.mjs` 在真实 `qa/fixtures/demo-page.html`（周报草稿 + 内联 SVG 流程图）上取证：

| 文件 | 说明 |
|---|---|
| `qa/report/p0-1/03-演示页-浏览态.png` | 插件未介入时的原页面 |
| `qa/report/p0-1/04-演示页-编辑态.png` | 工具条挂上后（页面标题/内容未变，light DOM 残留 0） |

## 五、未解决项（发布前必须补）

1. **Chrome 137+ 用户的分发路径**：只能走 `chrome://extensions` 手动「加载已解压的扩展程序」，
   并手动打开该扩展的「允许访问文件网址」。该步骤是**原生目录选择框，无法自动化**。
   > 注：`--load-extension` 路径下**不需要**开这个开关（§1.1 已实测）；只有手动加载路径才需要。
2. **启动器进程常驻未在本环境验证**：沙箱在命令结束后回收子进程，无法确认 `detached + unref`
   在交互式桌面下的窗口留存行为（该写法是标准做法，但**未实测**，如实标注）。

## 证据文件

| 文件 | 说明 |
|---|---|
| `qa/report/verify-launcher.log` | 门禁原始输出（**本地文件，未入库**：`.gitignore` 含 `*.log`） |
| `qa/probes/browser-channel-extension-capability.mjs` | 渠道 A/B 探针（可复跑） |
| `qa/probes/extension-demo-shot.mjs` | 演示页取证探针（可复跑） |
