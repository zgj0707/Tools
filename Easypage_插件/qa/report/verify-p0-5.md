# P0-5 验收记录 · 写回原文件

> **本批次回答的问题**：改完之后，能不能把结果**存回用户自己那份 HTML**。
>
> 这一条是**整个插件形态的立足点**。竞品证据链：Figma 原生不吃 HTML；Canva 官方帮助页自述
> HTML「暂时无法在 Canva 中开启或编辑」（Canva Code 2.0 亦为 `no code export for use outside Canva`）
> —— 两家都做不到「改完还是那份 HTML」。我们能做到，靠的就是本批次这条链路。
>
> **本次不修改任何旧形态行为**：`src/app/**` 零改动。84 条存量 e2e 一条未改、一条未删。

## 一、新增与改动

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/extension/save.ts` | 新增 | `buildSaveHtml`（纯函数，序列化 + 清理 + 自检）· `writeBack`（错误分支映射）· `saveCurrentDocument`（闭环） |
| `src/extension/ui/toast.ts` | 新增 | 轻提示；`saveMessage` 把结局翻译成人话（单独可测） |
| `src/extension/content.ts` | 改动 | 装配写回；保存前先提交就地改字 |
| `src/extension/ui/bar.ts` | 改动 | 保存按钮接上 `onSave`；`setSaveAvailable` → `setSaveState`（含 `busy`） |
| `src/extension/style/extension.css` | 改动 | `.ep-toast[data-tone='error']` 一种语气 |
| `tests/unit/extension-save.test.ts` | 新增 | 23 条单测 |
| `qa/probes/p0-5-manual-writeback.mjs` | 新增 | **门禁 G1 的一键人工脚本**（人手点原生框，脚本读盘校验） |

## 二、验收结果

探针 `qa/probes/extension-p0-4.mjs` **28/28 PASS**（Chromium 与 Edge **双载体一致**，其中第 26–28 项为本批次新增）。
单测 **256 passed / 28 files**（本批次新增 `extension-save.test.ts` 23 条）；`npm run check` 全绿。
e2e **84 passed**（`--workers=1`）。
扩展产物 `content.js` **100.06 kB / gzip 30.94 kB**（预算 160 kB）。

> 探针项数变化说明：本批次把 P0-5 三项加进原 P0-4 探针后为 **25 项**（Edge 当时只跑了 22 项）；
> 随后修「编辑不了容器内的东西」（见 `verify-p0-4.md` §八）又补了**容器矩阵 4 项**、
> 并作废原「双击容器只选中」1 项 ⇒ 现共 **28 项**，已两个载体都跑满。

| # | 断言 | 结果 |
|---|---|---|
| 26 | 🔴 保存按钮可用 ⇒ **content script 上下文里确实拿得到 FSA** | PASS `title="保存：写回这份 html 文件"` |
| 27 | 🔴 点保存前**先提交**正在进行的就地改字（否则最后一次输入会丢） | PASS 标记清零 |
| 28 | 🔴 原生保存框**真的弹出来了、在等人**（不是被环境立刻回绝） | PASS `aria-busy=true` |

单测覆盖真机里便宜测不了的三件事：写回前清理干不干净、原生框的**调用参数与全部错误分支**、
「残留未清干净就拒绝写入」的判定。

⚠️ **本批次唯一未自动化的环节 = 门禁 G1**（见 §六，**现已关闭**）：原生框弹出 → 用户选定文件 →
浏览器写盘，这三步**没有一步是我们的代码**（OS 级窗口，Playwright 与 CDP 都触不到）。
探针第 28 项能证明到「框在等人」为止；再往后由人手完成，脚本把人工压缩成两下点击并自动读盘校验。
**2026-09-23 用户已在真实环境跑通一次，读盘八项全过** —— 详见 §六。

## 三、两条必须讲明的语义边界

写回是**整份 DOM 的序列化**，不是「在原文件字节流上打补丁」—— 后者做不到：页面里拿不到原文件文本
（content script 的 XHR `file://` 被 `origin 'null'` + CORS 拒绝；MV3 service worker 的 fetch 只支持
http/https）。由此产生两条、都必须让用户知道：

1. **源码文本会被规范化，结构不变**：属性顺序、引号风格、自闭合写法按浏览器的序列化规则重写。
   内容与结构一致，`git diff` 会看到一些格式噪声。
2. 🔴 **页面若含脚本，脚本运行后的 DOM 也会被一起写回。** mermaid 这类「有源码、渲染出图」的页面
   最明显：改动被固化进渲染结果，下次打开重新渲染可能覆盖它。
   ⇒ 本批次**如实上报**：`SaveResult.hadScript`，成功提示里补一句「（页面含脚本：写回的是脚本运行后的结构）」。
   不静默处理，也不因此拒绝保存 —— 绝大多数静态 HTML 没有这个问题，一刀切拒绝反而挡掉主场景。

## 四、四个设计决策

1. **在副本上清理，而非在原页面上清理。** 先整份序列化成一个新 `Document`，再在副本上清理。
   若按「先清理活页面再序列化」做，一旦写入失败，**用户的页面已被我们动过**
   （抹掉 `contenteditable`、删掉 `ep-` class）。副本路线保证「写不成功 = 什么也没发生」。
2. **保存前先提交就地改字。** 正在编辑的那段内容只存在于 DOM 里；用户敲完字不按 Enter 直接点保存，
   不提交就会丢掉最后一次输入（探针第 24 项守这条）。
3. **`dirty` 是绊线，不是可达路径。** `stripEditorArtifacts` 与 `collectResidue` 口径同源、逐条对应
   （contenteditable / `data-ep-*` / `ep-` class / 覆盖层 / 注入 style·script 五种，清的与查的一一对应），
   所以在当前代码下它永远不会亮。保留它 + 单测只测**判定函数**（不编造假输入去点亮它），
   见 `save.ts` 里 `saveCurrentDocument` 的注释 —— 这条与仓库既往「四类假证据」的教训一脉相承。
4. **按钮可用性来自能力探测，不是「还没做完所以先禁用」。** 装配时做一次 `showSaveFilePicker` 存在性检测；
   探测不到的环境如实置灰并把原因写进 `title`，不做「点了没反应」。

## 五、已知边界（本批次刻意不做）

| # | 边界 | 影响 | 归属 |
|---|---|---|---|
| 1 | **原生框无法自动化** | 门禁 G1 需人手跑一次 | §六 已备一键脚本 |
| 2 | 每次保存都弹一次原生框（除非用户在框里选了同一文件） | handle 只存在内存里，刷新后即失 | P2：可用 IndexedDB 持久化 handle（结构化克隆支持） |
| 3 | 不支持的浏览器里没有兜底下载 | 非 Chromium 内核下按钮禁用，用户拿不到导出 | P2：`chrome.downloads` / `a[download]` blob 兜底（`07` §1 已列） |
| 4 | 用户文件里若恰好有 `id="ep-root"` 的元素，写回时会被删掉 | 极端巧合；`ep-` 命名空间本就是我们保留的 | 接受（与 `ep-` class 的既有契约一致） |
| 5 | 写回不感知「文件在磁盘上已被别处改动」 | 可能覆盖外部改动 | P2：可选 `getFile()` 比对 `lastModified` |
| 6 | 页面重渲染会抹掉插入的图片/箭头 | 见 `07` §7 | 属 C1 登记项，P1 处理 |

## 六、门禁 G1 · ✅ **已关闭**（2026-09-23 用户实测跑通）

用户在真实环境里跑了一次：编辑完保存，文件落在 **`C:\Users\Administrator\Desktop\manual-page.html`**
（2397 字节，10:28）。我读盘核对了脚本的八项校验，**全部成立**；用户改的字确实写进去了
（第 24 行由「属于页面本身。浏览模式下…」变为「属于模式下…」）。

顺带在真实产物上**实测证实**了 §三 那两条语义边界（原先只是从实现推出来的）：

| 边界 | 真实产物里的样子 |
|---|---|
| 写回是 DOM 序列化、不是字节补丁 | 原 `<table><tr>…` 被浏览器补成了 `<table><tbody><tr>…`（结构不变，属性顺序/引号风格被规范化） |
| 页面含脚本时，脚本运行后的 DOM 会被一起固化 | 页面上那个「点一下设 `data-probe-clicked`」的脚本执行过 ⇒ 写回文件里 `<body data-probe-clicked="yes">` 被固化了 |

⇒ **写回链路端到端成立**（这是整个插件形态的立足点）。P2 候选里那条
「IndexedDB 持久化文件 handle（免每次弹框）」正是为了减少这条链路上的人手步骤。

### 6.1 复现指引（想再跑一遍时）

**三种入口，任选其一**（都不要求你在项目目录下）：

```powershell
# ① 最省事：双击项目根目录的 verify-writeback.cmd（自动 cd 到项目、自动构建、跑完停住等你看结果）

# ② 命令行，在项目根目录跑：
npm run qa:g1

# ③ 分两步，手动指定项目目录：
cd "C:\Users\Administrator\Doubao\chats\2026-09-20\new-chat"
npm run build:extension
node qa/probes/p0-5-manual-writeback.mjs
```

只想检查环境、不启动浏览器：`npm run qa:g1 -- --check`。

> ⚠️ **路径基准已修正（2026-09-23）**：脚本原先按当前工作目录解析 `dist-extension/` 与夹具，
> 在别处执行会拼成 `C:\Users\<名>\dist-extension` 而报「找不到夹具/扩展产物」，看着像脚本坏了。
> 现在全部按**脚本自身位置**解析，任何工作目录下都指向同一组路径（`--check` 可自证）。
> 同理，`.cmd` 会先 `cd /d "%~dp0"`；且刻意用 ASCII 文件名 —— 非 ASCII 路径的 `.cmd`
> 在部分 Windows 设置下会被编码搞坏，静默影响 `cd` 与 node 调用。

脚本会：起带扩展的浏览器 → 打开**一份夹具副本**（放 `test-results/g1/`，不污染入库夹具）→
提示你在浏览器里做两件事；你在终端按回车后，它**自动读盘校验**八项：

写入标记 · `<!DOCTYPE html>` · **零 `contenteditable`** · **零 `data-ep-*`** · **宿主已移除** ·
原有 `<strong>` 仍在 · 页面自己的 `<script>` 仍在 · 以及**用浏览器重新打开写回后的文件**确认改动仍在。

## 七、证据文件

- `qa/probes/extension-p0-4.mjs` —— 28 项断言（第 26–28 项为 P0-5）
- `qa/probes/p0-5-manual-writeback.mjs` —— G1 人工脚本（含读盘校验）
- `tests/unit/extension-save.test.ts` —— 23 条纯逻辑单测
- `src/extension/save.ts` —— 文件头写明两条语义边界，`saveCurrentDocument` 写明绊线为何不该亮
