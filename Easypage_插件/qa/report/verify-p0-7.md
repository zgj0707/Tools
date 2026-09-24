# P0-7 验收记录 · 多文件页面防护

> **本批次由一次真实事故驱动，不是计划内需求。**
>
> 用户把一份 AI 工作流页面用易页编辑后保存，再打开发现**版式整体塌掉、侧栏变成流内文字**，
> 第一判断是「易页把内容改坏了」。
>
> 实测（见 §一）：**编辑器没有污染那份文件**；真正的原因是那份 `index.html` **不是单文件** ——
> 它依赖同目录的 `styles.css` 与 `app.js`，而保存时被存到了**桌面**，两个依赖没跟过去。
>
> 于是本批次做两件事：**① 提示**（动手之前就说清依赖谁、必须存回哪个目录）；
> **② 根治**（记住上次写回的 handle，以后不弹框 —— 位置既然不由用户每次重选，就没有「选错」这回事）。

## 一、根因（实测，不是推理）

| 事实 | 证据 |
|---|---|
| 原项目在 `…\chats\2026-09-18\new-chat\ai-workflow-site\`，含 `index.html` + `styles.css`(24 KB) + `app.js`(7 KB) | 目录实测 |
| 原 `index.html` 第 8 行 `<link rel="stylesheet" href="styles.css">`、第 2453 行 `<script src="app.js"></script>` | 逐行读取 |
| 桌面上那份里 `ep-root` / `data-ep-` / `contenteditable` / `ep-hover-box` 计数**全为 0** | 四项独立计数 |
| 桌面目录下**没有** `styles.css` / `app.js` | 目录实测 |
| 用户的编辑内容仍在（431,193 B vs 原件 428,934 B） | 字节数 + 内容比对 |

**结论**：编辑器是干净的；丢的是**同目录依赖**。
`showSaveFilePicker` 每次都让用户选位置，而**默认位置不是原文件的目录** —— 这是 P0-5 遗留的静默坑。

> ⚠️ 我在排查中先报过一次「112 个相对依赖」，其中 **110 个是我的正则误匹配**（`href=` 匹配到了
> `data-href="doc-01-s1"`），真实依赖**只有 2 个**。已在回复、`collectSiblingDeps` 的代码注释与
> 单测里三处如实更正。这条教训直接变成了实现里的硬约束：**属性一律走 `getAttribute`，不许正则扫源码。**

## 二、两条防线，以及「能做什么 / 做不到什么」

| | 做法 | 边界（必须讲明） |
|---|---|---|
| **提示** | 保存按钮的 `title` 里常驻「它依赖同目录的 `styles.css`、`app.js`，必须存回原目录 `…\` 并保持文件名」；一旦发现落盘文件名与原文件不同，改为**保存后弹警示** | `file://` 下 FSA **只给 `handle.name`，拿不到目录路径** ⇒ 「自动校验是否存回原目录」做不到。`nameMismatch` 是能拿到的最强信号，但**不是充分条件**（同名也可能存错目录）⇒ 只用来说「可能存错了」，不用来判定正确 |
| **根治** | 第一次保存后把 handle 记进 IndexedDB（键 = 文档路径）；下次直接写回**同一个文件**，`showSaveFilePicker` 连弹都不弹 | 整条路径是**尽力而为**：环境没有 IndexedDB、handle 序列化失败、权限退化、句柄过期 —— 任何一步不成立都**静默退回** P0-5 的弹框流程，结果不会比之前更差 |

## 三、先探能力，再写实现（不猜）

根治成立的前提是「拿到的文件 handle 能不能存下来、下次直接用」。这件事在 `file://` 上没人验证过，
所以先写 `qa/probes/file-handle-persistence.mjs` 量了一次：

| 问题 | 结论 |
|---|---|
| Q1 · `file://` 上 IndexedDB 可用且跨页面保留？ | ✅ **成立**（origin 就是 `file://`，所有本地文件共用一个库） |
| Q2 · handle 能否在 IndexedDB 里**序列化往返**？ | ⚠️ **未测定** —— `file://` 上 OPFS 抛 `SecurityError`，拿不到任何 handle 去测往返 |
| Q3 · content script 的**隔离世界**能用同一个库吗？ | ✅ **成立**（`hasIDB=true`） |

> 🔴 **Q2 未测定 ⇒ 不能拿它当前提。** 我第一版探针把 Q2 判成「❌ 不成立」，那是**假结论** ——
> 它实际是**没测到**。已改成三态输出（`null` 打印「未测定」），并据此决定：
> **P0-7 必须写成「尽力而为 + 优雅退化」**，而不是「靠它保证不弹框」。

## 四、新增与改动

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/extension/handle-store.ts` | 新增 | handle 持久化：`pathKeyOf`（按文档路径做键）· `looksLikeFileHandle` · `ensureWritable`（先 query 后 request）· `createHandleStore`（后端为 null 时返回**永远退化**的实现）· `createIdbBackend`。**所有函数永不抛** |
| `src/extension/save.ts` | 改动 | 新增 `collectSiblingDeps`（同目录相对依赖）· `directoryOf`（只用于显示）· `writeDirect`（不弹框直接写）；`writeBack` 加 `onPicked` 回调（**写成功后**才记 handle）；`saveCurrentDocument` 接入 store，返回 `direct` / `nameMismatch` |
| `src/extension/ui/bar.ts` | 改动 | `SaveState` 增加 `deps` / `more` / `dir`；`saveInfo` 让依赖信息**跨多次 `setSaveState` 活着**；`title` 统一由 `saveTitle` 出（含「不可用」那一档，删掉重复常量） |
| `src/extension/ui/toast.ts` | 改动 | 新增 `depsWarning` / `saveTitle`；`saveMessage` 增加 `direct` 档 |
| `src/extension/content.ts` | 改动 | 装配 store 与依赖侦测；保存后按 `nameMismatch` 合成警示 |
| `qa/probes/file-handle-persistence.mjs` | 新增 | 能力探针（§三） |
| `qa/probes/extension-p0-7.mjs` | 新增 | 提示面验收探针，**9 项** |
| `qa/fixtures/multi-file/{index.html,styles.css,app.js}` | 新增 | **真的**多文件夹具（不存在的依赖会让页面报错、污染断言） |
| `tests/unit/extension-handle-store.test.ts` | 新增 | 17 条（含一个**假 IndexedDB**，把后端接线也纳入断言） |
| `tests/unit/extension-bar.test.ts` | 新增 | 6 条（保存按钮 `title` 的状态机） |
| `tests/unit/extension-save.test.ts` | 改动 | +26 条（依赖侦测 / 目录显示 / 直接写回 / store 接线 / 文案） |
| `vite.config.ts` | 改动 | 单测环境关掉文件加载（§八·3） |

## 五、验收结果

- **P0-7 探针 9/9 PASS**，Chromium 与 Edge **双载体一致**（`qa/probes/extension-p0-7.mjs`）。
- **P0-4 探针 28/28 PASS**（复跑确认 `bar.ts` / `toast.ts` 改动无回归；第 26 项读数
  `title="保存：写回这份 html 文件"` 同时反证了单文件页面不误报依赖）。
- **单测 305 passed / 30 files**（原 256 / 28；本批次 +49）。
- **e2e 84 passed**（`--workers=1`，串行）。
- `npm run check` **全绿**：typecheck + lint + 单测 + build + 许可证（328 包无禁止许可）。
- 扩展产物 `content.js` **106.86 kB / gzip 32.89 kB**（原 100.06 / 30.94；预算 160 kB）。
- `src/app/**` **零改动**，84 条存量 e2e 一条未改、一条未删。

探针 9 项明细（Edge 完全一致）：

| # | 断言 | 结果 |
|---|---|---|
| 1 | 扩展已注入本地页面（去页面里找 `#ep-root`，不靠「浏览器起来了」推断） | PASS `#ep-root × 1` |
| 2 | 🔴 **夹具前提成立**：同目录的 `app.js` 真的被加载了 | PASS `#tick` 被改写 |
| 3 | 保存按钮可用（依赖提示不该把功能弄坏） | PASS `disabled=false` |
| 4 | 🔴 提示里报出**两个同目录依赖** | PASS `…它依赖同目录的 styles.css、app.js…` |
| 5 | 提示里报出原目录（FSA 拿不到路径，这是唯一来源） | PASS |
| 6 | 提示里**不含**编辑器自己的东西（`content.js` / `ep-`） | PASS |
| 7 | 页面确实含脚本（那句「含脚本」的补充说明才有依据） | PASS `script × 1` |
| 8 | 🔴 单文件页面**不报**依赖（反向确认：警示不是恒真的） | PASS `保存：写回这份 html 文件` |
| 9 | 全程无未捕获异常 / 无 `console.error` | PASS `0 条` |

第 2 项是刻意加的**前提检查**：若 `app.js` 没跟到同目录，`#tick` 会停在「脚本还没跑起来。」——
那么后面所有「依赖侦测正确」的结论都建立在错误前提上。**先确认前提成立，再判断结论。**

## 六、五个设计决策

1. **`nameMismatch` 不进 `saveMessage`，由调用方合成。** 两条文案的时态会打架：`saveMessage` 说
   「已写回 X」，`depsWarning` 说「必须与原文件放同一目录」。分开各写一句、由 `content.ts` 拼成
   一句话，比让 `saveMessage` 内部改用一条警示更清楚。因此 `depsWarning` 的措辞刻意**无时态**
   （「必须与原文件放在同一目录」），保存在前（悬停提示）与保存之后（警示）都读得通。
2. **依赖为空时不警示。** 单文件页面换个名字存下**没有任何后果**；乱报只会稀释真正该被看见的警示。
   这条与探针第 8 项互为表里。
3. **`direct` 写失败不在这里下结论。** `writeDirect` 与 `writeBack` 分开写而不是加分支：前者失败
   **不是终局**（句柄过期、权限退化很常见，调用方会退回去让用户重选），后者失败就是用户看到的最终
   结果。混在一个函数里会让「该不该退」变得难判断。
4. **依赖只在装配时算一次，刻意不动态重算。** 读取时页面可能已被脚本改过 DOM；而按钮提示应当只
   反映「这份文件本来的依赖」，不该随页面渲染跳动。
5. **`SaveResult.nameMismatch` 不参与任何自动判定。** 它只用来提示 —— FSA 给不到路径，同名也可能
   存错目录，**这个信号既非充分也非必要**。

## 七、未自动化的一环 = 门禁 G1 复验

「记住 handle ⇒ 下次不弹框」这条**本探针不覆盖**，也不假装覆盖：写回原文件要经过 OS 级原生对话框，
Playwright 与 CDP 都碰不到（P0-5 已实测）。复验用现成的一键脚本，人工压缩成两下点击：

```
npm run qa:g1      # 构建扩展 + 启动 + 引导点保存 + 自动读盘校验
```

**新增一条复验要求**：第 ①②次保存之后，**第 ③ 次点保存应当不再弹框**，且提示变成
「已写回原文件 `xxx.html`（未弹框）」。这是 P0-7 唯一的真机判据。

## 八、本次自查发现并修掉的三个问题

1. **`app.js` 与 `./app.js` 被当成两个依赖。** 单测先跑出来的真问题：同一份文件的两种写法各自
   成条，提示会写成「依赖 `app.js`、`./app.js`」—— 看着像两个文件，恰好稀释掉这条警示的可信度。
   已改为**按解析后的路径去重、显示首次出现的原始写法**，并补一条反向断言（同目录与子目录的同名
   文件不能被并成一条，防止「去过头」）。
2. **假 IndexedDB 的类型转换写法不对。** 初版直接 `as IDBTransaction`，`tsc` 报 TS2352（真实
   DOM 签名是 `(this: IDBTransaction, ev: Event) => any`，与我们挂的无参回调不兼容）。改成宽松结构
   对象 + 末尾 `unknown` 转换。
3. 🔴 **我新加的夹具让单测真的去联网了。** 夹具里写 `href="styles.css"` / `src="app.js"`，
   happy-dom 默认**真的去拉**，失败后往 `window.console` 派发错误 —— 而 `DOMParser` 造出的游离
   document **没有 window** ⇒ `Cannot read properties of null (reading 'console')`，19 条
   Unhandled Rejection 污染整轮输出，耗时从 1.8s 涨到 4.1s。
   修法在 `vite.config.ts`：`disableCSSFileLoading` + `disableJavaScriptFileLoading`
   + `handleDisabledFileLoadingAsSuccess` **三件套缺一不可** —— 只写前两项只是把「联网」换成
   「派发一个 notSupportedError」，照样崩。修完 19 → 1，剩下的 1 条来自我夹具里的 `<iframe src>`，
   已换成不触发导航的元素类型（并在测试注释里写明为什么夹具刻意不放 `iframe`）。
   ⇒ **单测零网络 I/O 现在是配置层的硬保证，不再依赖写夹具时的小心。**

## 九、本次发现的既存问题（与 P0-7 无关，如实登记）

`npm run qa:metrics` 报 `gate: fail 未通过：losslessRate >= baseline`。**这不是本批次造成的**，
有对照实验为证：

1. **把本批次全部改动 `git stash` 后再量一次 HEAD** ⇒ `losslessRate=0.7165`，**与带改动时逐位相同**。
2. 结构证据：`dist/index.html` 改动前后同为 **135.69 kB**；`src/app/**` 零改动。
3. 根因：`run-metrics.mjs` 的 `listFixtures()` 是**顶层 `.html` 的 glob**，而
   `qa/report/metrics-baseline.json` 记于 `a507bb5`（`samples:10`）；`demo-page.html`、`pick-page.html`
   是**同日稍后**加入的 ⇒ 样本集 10 → 12，两个新样本（`losslessRate` 0.25 / 0.6825）把总均值拉低。
   **门禁自那时起就红了**，`hitRate` 一直是 1（坐标类问题为零）。

**建议（不在本批次执行）**：门禁改为**按 `perFixture` 逐项比对**（报告里本来就有这个字段），
而不是拿「glob 出来的总数」比一个固定基线 —— 否则**每加一个夹具都会让门禁变红**，
红灯会迅速失去信号意义。是否顺带重录基线，请定。

## 十、结论

用户报的那个现象，**不是编辑器改坏了内容**，是「多文件页面被存到别处」。本批次把这件事变成
**用户动手前就能看见的一条提示**，并把「弹框选位置」这个坑从主路径上拿掉（`direct` 写回）。
`direct` 面仍需 G1 复验（§七），提示面已双载体 9/9 取得实测证据。
