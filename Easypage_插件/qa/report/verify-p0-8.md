# P0-8 验收记录 · 另存到同目录 `_改/`（不覆写原文件）

> 🔴 **本记录当天即被 P0-9 取代**（用户重新梳理：「新文件应该是自包含的，可以直接拉出去被分享」）。
> 落点从 `_改/` 子文件夹改为**同目录 `原名_改.html`**，依赖从「留原处 + `<base>`」改为**内联**。
> 现行口径见 **`qa/report/verify-p0-9.md`**。
> **保留本文件的两个理由**：① 「**不覆写原文件**」这条裁决仍然有效，且它第一次是在这里落地的；
> ② 它记录的两组实测证据（`base-href-capability` 4/4、`directory-copy-capability` 的读盘通道结论）
> 仍在取证链上，且其中一条**理由**须被更正（见下方 §三末的更正段落）。
> ⚠️ 阅读时请把本文所有 `_改/`、`<base href="../">`、`另存到 _改` 理解为**已被 P0-9 替换的历史口径**。

> **本批次是一次产品形态转向，由用户裁决直接触发。**
>
> 用户原话：`我不想覆写原文件；有没有办法直接复制一份 css 和 js？并且新建一个文件夹「_改」来保存修改后的文件和 css`
>
> 紧接着用户自己想到了更省事的路径：`emm，我突然想起来，html 对其依赖的文件是有引用的吧，那我们直接在改写后的 html 里将引用路径修改一下就行吧？`
>
> 后半句是本批次的**技术主干**。我把「引用路径逐个改写」在实测里换成了**更强的等价物**：
> 一行 `<base href="../">`（见 §二）。**结论：用户的直觉是对的，而且比逐条改写更完备。**

## 一、四项用户裁决，逐条落地

| 问题 | 用户裁决 | 落地 |
|---|---|---|
| 保存入口 | **替换**保存按钮 | 按钮可访问名 `保存到原文件` → **`另存到 _改`**（3 个探针 + 1 个单测同步） |
| 依赖范围 | **会影响内容显示的全部** | 依赖**不复制**，改由 `<base href="../">` 让副本从原目录读取（§三 说明为什么「复制」反而不完备） |
| `_改/` 位置 | 与原文件同目录，**自动预选** | ⚠️ **「自动预选」做不到**：`showDirectoryPicker` 的 `startIn` 只接受 well-known 目录名，**不接受路径** ⇒ 改为「**第一次手选原目录 + 之后零弹框**」（目录句柄按文档路径记忆） |
| 快照恢复 | **不需要了** | 已移除相关方案 —— 原文件逐字节不动，**它本身就是备份**，快照是重复的 |

> 📌 还有一项**用户未作答**的选择题：`_改/` 要不要「自包含」（能整体搬走）。我按两选项**共用的主干**先做
> （目录句柄 + 建 `_改/` + 写 html + 插 base）；「复制依赖」是纯附加块，用户要就随时加（代价见 §三末）。

## 二、能力实测（先探能力，再写实现）

三份探针，全部落盘入库：

| 探针 | 问的问题 | 结论 |
|---|---|---|
| `qa/probes/directory-copy-capability.mjs` | 在 `file://` 下，**从哪读得到同目录文件**？目录选择框能不能用？ | 见 §2.1 / §2.2 |
| `qa/probes/base-href-capability.mjs` | 子目录里的另存 html，用 `<base href="../">` 能不能完整复用原目录依赖？ | ✅ **4/4 PASS**（含反向确认），见 §2.3 |
| `qa/probes/p0-8-manual-dir-save.mjs` | 真机门禁（人来点框） | 判据见 §六 |

### 2.1 🔴 读同目录文件的通道只有一条

| 位置 | `fetch(file://…)` | `XHR` | `link.sheet.cssRules` |
|---|---|---|---|
| **扩展 Service Worker** | ✅ **通**（`status=200`，内容命中标记） | — | — |
| 页面 | ❌ 被拦 | ❌ 被拦 | ❌ 被拦 |
| content script | ❌ 被拦 | ❌ 被拦 | ❌ 被拦 |

- 实测**不加 `file:///*` host_permissions 也通**（SW 侧）；而页面 / content script 侧**加不加完全一样**。
  ⇒ content script 永远受**页面自身**的同源策略约束。**别在页面侧想办法。**
- ⚠️ **反直觉**：`--allow-file-access-from-files` 能救活 **XHR 与 cssRules**，却**救不活 `fetch`**
  （`fetch` 按 CORS 模式走，而 `file://` 响应没有 CORS 头）。且它是启动参数，普通用户不会开，
  **不可当方案前提**。

### 2.2 `showDirectoryPicker` 在 `file://` 下可用

- ✅ 有头实测**目录框真的弹出**（promise 2.5 s 内未决 = 已在等人）。
- ⚠️ 但**「无手势」也返回 `AbortError`**，与「有手势」**无差别** ⇒ 这一格**没有区分力**，
  不可再拿它当「缺手势」的判据（此处纠正了 P0-5 探针的一处**解读边界**）。
- ⚠️ `startIn` **不接受路径** ⇒ 「打开就停在这份 html 所在目录」做不到（§一 第二行）。

### 2.3 🔴 `<base href="../">` 一行让副本完整复用原目录依赖（4/4，含反向确认）

夹具：`test-results/probe-base/proj/`（`styles.css` · `app.js` · `fig1.png` · `bg.png` · `data.json`）
+ `proj/_改/{with-base.html, without-base.html}`。

| 断言 | `with-base` | `without-base`（**刻意的反向确认**） |
|---|---|---|
| `document.baseURI` | `file:///C:/…/proj/` ✅ | `file:///C:/…/proj/_改/` |
| `<h1>` 颜色（上层 `styles.css`） | `rgb(22, 93, 255)` ✅ | `rgb(0, 0, 0)` ❌ |
| `#tick`（上层 `app.js` 执行） | 「脚本已跑起来」✅ | 「脚本还没跑起来。」❌ |
| 图片 `naturalWidth` | `1` ✅ | `0` ❌ |
| 内联 `<style>` 里的 `url(bg.png)` | 指回原目录 ✅ | 指回 `_改/` ❌ |
| `fetch('data.json')` | 指回原目录 ✅ | 404 ❌ |

> **反向确认为什么必须有**：若两种都「能用」，说明 `<base>` **不是起作用的那个因**，
> 那整条方案就建立在一个巧合上。去掉 base 后**css / js / 图片三样全坏** —— 这才是因果证据。

### 2.4 🔴 `<base>` 的实测副作用

- 页内 `#锚点` 被解析成 `file:///C:/proj/#top`（**base 所在目录**）⇒ 点它会跳到**目录页**。
  不带 base 时才是正确的 `_改/xxx.html#top`。
  ⇒ **`<base>` 与「页内锚点导航」不可兼得。** 已用 `countFragmentAnchors` 计数并在提示里说明。
- `<base>` **必须插在 `<head>` 最前面** —— 它只影响出现在它**之后**的 URL 属性。
- **页面自带 `<base href>` ⇒ 绝不覆盖**（规范上只有第一个带 href 的 base 作数；插第二个无效且会掩盖问题）
  ⇒ 只回报 `existingBase`，由提示层告诉用户。

## 三、🔴 推翻我上一版方案的核心假设：「复制依赖 = 完备」是错的

我上一版的想法是：把 `styles.css` / `app.js` / 图片一并拷进 `_改/`，副本就**自包含**了。
**实测否掉了它。**

- 不带 `<base>` 时，`app.js` 里的 `fetch('data.json')` 会解析到 `_改/data.json` ⇒ **404**。
- **复制依赖并不能消除它** —— 我们**静态扫描不到 js 会请求什么**（动态拼接无底，字符串拼 URL、
  读变量再请求都可能）。
- ⇒ 真正让**动态请求**正确的，只有「**资源仍在原处**」这一条路。
- ⇒ `<base href="../">` 不是「逐条改写引用」的偷懒替代，而是**唯一能覆盖动态请求的手段**。

> 📌 如果用户最终要「自包含」，做法是**在主干之上加一个复制块**（代价如实告知：动态请求会坏、
> 且需递归处理 css 内的 `url()`）。当前**不做**。

> 🔴 **2026-09-23 更正（我自己上面这段夸大了一处，实测打脸）**：`qa/probes/selfcontain-capability.mjs`
> 量到 —— `fetch('data.json')` 在**原位也一样失败**（`TypeError: Failed to fetch`）。
> 原因是 `file://` 页面**本身就禁止 `fetch`/XHR 读本地文件**（与 `<base>`、与搬不搬走都无关）。
>
> 所以上面「只有 `<base>` 能治动态请求」是**错的**：`<base>` 也治不了，那类请求在 `file://` 上**根本通不过**。
> 量到的真实差别只在**静态子资源**上（`<link>` / `<script src>` / `<img src>` —— 这些 `file://` 之间是放行的）：
> 它们才是「搬走就坏」的真问题，而**内联能把它完全治掉**（同探针 10/10，含反向确认）。
> ⇒ 结论不变的是「`<base>` 方案让副本离开原目录就废」，**变的是理由**：原因是**静态子资源**，
> 不是动态请求。**教训：把「URL 解析到哪里」当成了「请求会不会成功」——解析对不等于能取到。**

## 四、新增与改动

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/extension/dir-save.ts` | **新增** | `WORK_DIR='_改'` · `WORK_DIR_BASE='../'` · `dirKeyOf`（键前缀 `dir:`，**与 P0-7 的文件句柄分开**，否则升级时会取回旧的文件句柄当目录用）· `looksLikeDirHandle` · `browserDirPicker` · `saveToWorkDir`（记忆目录 → 弹框兜底 → `hasFile` 探 `dirMatched` → `getDirectoryHandle(create:true)` → 写盘 → **写成功后才记目录**） |
| `src/extension/handle-store.ts` | 改动 | 放宽为 `PermLike` / `HandleLike extends PermLike` 分层（目录句柄**没有** `createWritable`）；`load` 改回 `Promise<unknown>` —— **原样返回、由调用方判形状** |
| `src/extension/save.ts` | 改动 | `buildSaveHtml` 增 `BuildSaveOptions{baseHref}` 与返回值 `baseInjected` / `existingBase`；新增 `countFragmentAnchors`；`saveCurrentDocument` 标 `@deprecated`（无生产调用方，保留供取证链） |
| `src/extension/ui/toast.ts` | 改动 | `saveMessage` 全改另存口径；**删除 `depsWarning`**（其前提「依赖必须跟走」已消失）；`saveTitle` 改「原文件不会被改动」+「依赖仍从原目录读取」；新增 `saveCaveats`（3 条**各自独立判定**的提示） |
| `src/extension/ui/bar.ts` | 改动 | 按钮名、`SaveState` 注释 |
| `src/extension/content.ts` | 改动 | 装配 `browserDirPicker` / `saveToWorkDir`；`workDirPath` 用于提示 |
| `qa/probes/directory-copy-capability.mjs` | 新增 | §2.1 / §2.2 能力探针 |
| `qa/probes/base-href-capability.mjs` | 新增 | §2.3 / §2.4 能力探针 |
| `qa/probes/p0-8-manual-dir-save.mjs` | 新增 | **人门禁 G1**（替代 P0-5 版「写回原文件」脚本） |
| `tests/unit/extension-dir-save.test.ts` | 新增 | 18 条（§五） |
| `package.json` | 改动 | `qa:g1` 改指 `p0-8-manual-dir-save.mjs` |

## 五、验收结果

| 项 | 结果 |
|---|---|
| `npm run check`（typecheck + lint + 单测 + build + 许可证） | ✅ **全绿** |
| 单测 | ✅ **326 passed / 31 files**（原 305 / 30，**+21**） |
| e2e（`--workers=1` 串行，旧外壳 84 条回归网） | ✅ **84 passed** |
| 探针 `base-href-capability.mjs` | ✅ **4/4 PASS**（含反向确认） |
| 探针 `extension-p0-7.mjs`（提示面，新口径） | ✅ **11/11 PASS** |
| 探针 `extension-p0-4.mjs`（Word 语义编辑，复跑防回归） | ✅ **28/28 PASS**（首次跑 27/28，FAIL 项是**探针期望值未同步**，见下） |
| 探针 `qa:metrics` | ⚠️ **门禁红，与本次无关**（既存问题，见 §七） |
| `content.js` 体积 | **107.89 kB / gzip 33.58 kB**（预算 160 kB） |

> 🔴 **P0-4 探针那 1 项 FAIL 值得单独记**：断言是 `title` 必须含字符串 `写回`，而 P0-8 已把「可用」分支的
> 措辞换成「**另存到 _改/：写入 …，原文件不会被改动**」⇒ FAIL 是**我在改文案时漏同步探针**，**不是产品回归**。
> 处置：断言改为两个**语义标记**（`另存到 _改` + `原文件不会被改动`）而非整句 —— 整句含**机器相关的绝对
> 路径**，写死会换机即红。这条与 §八·6 是同一类：**改了文案就要全仓搜它被谁断言过**。

### 5.1 `extension-dir-save.test.ts` 两层假目录覆盖的 18 条

两条假目录（`fakeRootDir` → `_改/` → 文件），断言的是**调用形状**而非实现细节：

- `looksLikeDirHandle` 四种形状：**文件句柄不认**、只有 `getFileHandle` 的也不认、`null` 不认、真目录认。
- `dirKeyOf`：在 `pathKeyOf`（= `协议//主机 + pathname`，非法 URL 退回原文）前加 **`dir:` 命名空间前缀**
  —— 与 P0-7 的文件句柄**分开存**，否则升级时会取回旧的文件句柄当目录用（键空间污染）。
- 写出的 html：**含 `<base href="../">` 且位置在 `</head>` 之前**。
- `_改/` 用 `create:true`（**复用而非重建**）。
- 🔴 **记忆命中时 `calls() === 0`** —— 这是「零弹框」的**唯一可自动化的证据**。
- **写成功之后才**记目录（写失败不污染记忆）。
- `cancelled` 时**零写盘**。
- `AbortError` → `cancelled`；`SecurityError` / `NotAllowedError` → `unsupported`；其余 → `failed`（**分得开**）。
- `dirMatched` **双向**（原文件名在该目录 / 不在该目录）。
- `workDirPath` 形如 `C:\proj\_改\`。
- **零 `ep-` 残留**。
- `anchors` 回报 2 与 0 两种情况。
- **页面自带 `<base>` 时不动它、且最终只留一个 `<base>`**。

## 六、G1 人门禁（`npm run qa:g1`）

原生目录框是 **OS 级窗口，Playwright 与 CDP 都触不到**（P0-5 已实测确认的硬边界）。
真正越过边界的那一步（用户选定目录 → 浏览器写盘）**没有一步是我们的代码**，如实标成**人手门禁 G1**。

脚本把人工压缩成两下点击 + 自动读盘校验。**最要紧的三条断言是「没发生什么」**：

```js
['🔴 原文件**逐字节未变** —— 这是「不覆写」的全部意义', Buffer.compare(beforeBytes, afterBytes) === 0],
['🔴 原文件的修改时间也没变（没被重写过一遍）', afterMtime === beforeMtime],
[`🔴 原文件里**没有**你输入的「${MARKER}」（改动没落回原文件）`, !afterBytes.toString('utf8').includes(MARKER)],
```

**第二要紧的是「重新打开副本，依赖仍然可用」** —— 这是 base 方案在实践里的**唯一证据**：

```js
['documents.baseURI 指回了原目录', baseURI.endsWith('/g1/'), baseURI],
['`#tick` 被 app.js 改写（=> 上层目录的 js 加载成功）', !!tick && tick.includes('脚本已跑起来'), tick],
['`#h` 被 styles.css 上色（=> 上层目录的 css 生效）', hColor === 'rgb(22, 93, 255)', hColor],
[`改动仍在（#explain 含「${MARKER}」）`, explain.includes(MARKER)],
```

另断言：依赖**没有**被复制进 `_改/`、零 `ep-` 残留、引用**未被改写**（走 base 而非逐条改）。

> ⚠️ 副本连同**依赖**一起复制到 `test-results/g1/`（`styles.css` / `app.js`）—— 否则整轮会退化成
> 单文件验证，**测不到 base 到底有没有起作用**。

## 七、遗留与待决

| # | 项 | 状态 |
|---|---|---|
| 1 | **`_改/` 是否要自包含** | ⬜ **用户未作答**。当前主干不含复制块；要就加（代价见 §三末） |
| 2 | `qa:metrics` 门禁红 | ⚠️ **既存问题，与本批次无关**。`listFixtures()` 是顶层 `.html` 的 glob，baseline 记于样本 10 的时代，后加到 12，两个低分样本拉低均值（`losslessRate` 0.7165 < 0.888）。已用 `git stash` 对照实验验证（`losslessRate` 逐位相同）。**建议**改为按 `perFixture` 逐项比对；**未擅自重录基线** |
| 3 | Edge 双载体复跑 | P0-4 / P0-7 探针在 Chromium + Edge 双载体一致；本批次的能力探针**只在 Chromium 跑过**（`_改/` 链路依赖 Edge 同样支持 `showDirectoryPicker`，但**未实测**） |
| 4 | Chrome 137+ 用户的「人话引导」 | 发布前欠：手动加载 + 手动开「允许访问文件网址」 |

## 八、本轮踩到的坑（写进纪律）

1. 🔴 **探针假证据的第四副面孔：期望值本身写错。** P0-7 探针 1 项 FAIL —— `title` 里没有小写
   `c:\Users\…\_改\`。**根因**：`path.resolve()` 给小写盘符，浏览器把 URL 里的盘符规范成**大写**，
   而 `directoryOf` 读的是 `location.href`。**这不是产品回归**，是我的期望值写错了。
2. 🔴 **Playwright 的 `page.evaluate` 会序列化函数体**，闭包变量**一个都拿不到**。我第一版拼字符串 +
   `new Function(\`return ${runner}\`)()` 是**错的** —— `new Function` 在 **Node 侧**求值，直接碰不存在的
   `window`。改为**自包含**的页面函数。这类错误语法检查照不出来，只在真跑时炸。
3. ⚠️ **无手势必须在有手势之前测** —— 否则前面点击留下的 transient activation 会让「无手势」也走到弹框。
4. 🔴 **`HandleStore.load<T>` 的泛型方法逼着实现方泛型化**（`TS2322`）。修法：`load` 回 `Promise<unknown>`，
   形状判定上移调用方 —— 这**同时**解决了「文件句柄与目录句柄形状互斥」的设计问题（拿错形状的报错
   会发生在**写盘中途**而非取用时，很难查）。
5. 🔴 **新测试漏了 `// @vitest-environment happy-dom`** ⇒ 15 条 FAIL、报 `DOMParser is not defined`。
   根因：仓库 `vite.config.ts` 全局 `environment:'node'`，DOM 测试**各自在文件首行声明**。
6. ⚠️ **改了 `title` 就要同步单测期望值**（`extension-bar.test.ts` 一处），属正常收尾而非缺陷。
