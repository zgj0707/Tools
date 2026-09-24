# P0-4 验收记录 · Word 语义编辑（改字 / 字符格式 / 颜色 / 撤销）

> **本批次回答的问题**：插件挂上去之后，用户能不能像用 Word 那样「就地改几个字、
> 把某几个字加粗、换个颜色，改错了撤回来」。
>
> 这是用户对插件形态的原始诉求里的一半（原话：「改字、改颜色、加粗倾斜下划线，就像
> word 那样」）；另一半是 mindmap 语义的图形编辑，那是 P1。
>
> **本次不修改任何旧形态行为**：`src/app/**` 只动了 `icons.ts`（纯新增三个图标）。
> 84 条存量 e2e 一条未改、一条未删。

## 一、新增与改动

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/extension/inline.ts` | 新增 | 就地改字（双击进入 / Enter 提交 / Esc 还原） |
| `src/extension/format.ts` | 新增 | 字符格式：有选区走字符级，无选区走元素级 |
| `src/core/commands/commands.ts` | **改动** | 新增 `SetHtmlCommand`（见 §三 · 缺陷 1，这是本批次唯一的存量文件改动） |
| `src/app/ui/icons.ts` | 改动 | 新增 `bold` / `italic` / `underline` 三个图标（纯新增） |
| `src/extension/ui/bar.ts` | 改动 | 工具条加字符格式组 + 色板浮层 + 撤销/重做；新增 `syncFormat` / `syncHistory` |
| `src/extension/interaction.ts` | 改动 | 自实现双击检测；编辑元素内指针事件放行；`Ctrl+B/I/U/Z/Y` 接管 |
| `src/extension/content.ts` | 改动 | 装配 `HistoryStackImpl` + `InlineEditor`，新增 `syncBar()` |
| `src/extension/style/extension.css` | 改动 | 色板浮层与当前色指示条 |
| `tests/unit/extension-format.test.ts` | 新增 | 格式逻辑单测 14 条 |
| `qa/probes/extension-p0-4.mjs` | 新增 | 真浏览器验收 18 项 |

## 二、验收结果

载体：Playwright Chromium（默认）**28/28 PASS**；系统 Edge **28/28 PASS**（跨渠道一致）。

| # | 断言 | 结果 |
|---|---|---|
| 1 | 双击 ⇒ 进入就地改字（`contenteditable` + `data-ep-editing`） | PASS |
| 2 | 输入 + Enter 提交 ⇒ 文本变了、编辑标记已清除 | PASS |
| 3 | 🔴 **改字不丢行内标签**（`<strong>` 仍在） | PASS |
| 4 | Esc ⇒ 放弃修改，内容回到编辑前 | PASS |
| 5 | 加粗：点一下设 `fontWeight:700`，按钮 `aria-pressed=true` | PASS |
| 6 | 加粗：再点一下取消（**清掉内联值**，不是写 400） | PASS |
| 7 | 倾斜 / 下划线 各切一次 | PASS |
| 8 | 未选中元素时格式按钮禁用 | PASS |
| 9 | 色板开合、取色写入 `style.color` 并自动关闭 | PASS `rgb(192,57,43)` |
| 10 | 🔴 `Ctrl+Z` 撤销 / `Ctrl+Shift+Z` 重做 往返 | PASS |
| 11 | 撤销按钮：空历史禁用 → 有历史可用 | PASS |
| 12 | 🔴 **有选区时 `Ctrl+B` 包成 `<strong>`（字符级，非整段）** | PASS |
| 13 | 已包裹的选区再按 `Ctrl+B` ⇒ 解包（与 Word 一致） | PASS |
| 14 | 🔴 改字态下、**编辑元素内**的 `pointerdown` 不被拦截 | PASS `defaultPrevented=false` |
| 15 | 改字态下、编辑元素**之外**仍被拦截 | PASS `defaultPrevented=true` |
| 16 | 🔴 双击进改字 ⇒ 出现**虚线**改字框，且与实线选中框**叠加**在场 | PASS `720×27`，`border-style=dashed` |
| 17 | Enter 提交 ⇒ 改字框收起 | PASS |
| 18 | Esc 放弃 ⇒ 改字框也收起 | PASS |
| 19 | 🔴 双击 leaf 容器（`<div>` 只装文字）⇒ **可改字** | PASS `#inner` |
| 20 | 🔴 双击 leaf 容器（`<section>` 只装文字）⇒ **可改字** | PASS `#bigbox` |
| 21 | 双击表格单元格（`<td>`）⇒ 可改字 | PASS |
| 22 | 🔴 双击**含块级子元素**的容器（`#outer` 含 `#inner`）⇒ 仍只选中、不进改字 | PASS |
| 23 | 🔴 退出编辑模式 ⇒ `contenteditable` / `data-ep-editing` 全清 | PASS `0 / 0` |
| 24 | 🔴 light DOM 未被污染（除 `#ep-root` 外零 `ep-` 节点） | PASS `leaked=0` |
| 25 | 零控制台报错 / 零未捕获异常（**全程累计**） | PASS `errors=0` |
| 26 | 🔴 保存按钮可用 ⇒ content script 上下文里确实拿得到 FSA | PASS |
| 27 | 🔴 点保存前会先提交正在进行的改字（否则最后一次输入丢掉） | PASS |
| 28 | 🔴 原生保存框真的在**等人**（而非被环境立刻回绝） | PASS `aria-busy=true` |

- 第 16–18 项是补齐 §五 · 1 那个缺口（改字态无可见提示）时加的，实现见 §七。
- 第 19–22 项是**容器矩阵**，2026-09-23 用户实测反馈后补，见 §八。原来的第 22 项
  「双击容器类（`div`）⇒ 只选中」**已作废** —— `#inner` 这类「只装文字的 div」现在应当可改。
- 第 26–28 项属 P0-5 写回链路，随保存按钮一起进了本探针（取证件见 `verify-p0-5.md`）。

单测：**256 passed / 28 files**。其中 `extension-format.test.ts` 14 条、`extension-inline.test.ts`
（容器可编辑性结构判定）13 条。`npm run check` 全绿（tsc + build + 许可证 + 全部单测）。
e2e **84 passed**（`--workers=1`，`src/app/**` 除 `icons.ts` 外零改动）。
扩展产物 `content.js` **100.06 kB / gzip 30.94 kB**。

## 三、本批次修掉的缺陷

### 缺陷 1 🔴 「HTML 内容配了纯文本命令」—— 会让整段文字变成源码

`inline.ts` 刻意改成提交 `innerHTML`（旧实现提交 `textContent`，会把
`<p>结论：<strong>留存下滑</strong></p>` 拼平成纯文本、丢掉行内格式）。
但落库那一步最初仍复用了旧命令 `SetTextCommand`，而它是 `textContent` 语义 ——
`execute()` 里写着 `this.target.textContent = this.next`。

后果：提交后页面**直接显示出这串源码**（`<strong>留存下滑</strong>` 当文字渲染），
且原来的 `<strong>` 元素被整个抹掉。用户只改了几个字，行内格式连同标签一起毁掉。

- **处置**：新增 `SetHtmlCommand`（`innerHTML` 语义），`SetTextCommand` **原样不动** ——
  把它改成 HTML 语义会让存量纯文本里的 `&` / `<` 被当标记解析，那是另一场回归。
  两个语义分开，各管一摊。
- **为什么没被单测拦住**：单测覆盖的是格式逻辑，不覆盖「命令实现与调用方约定的语义是否匹配」。
  这是**跨模块的隐式契约**，只有真机跑「改字后标签还在不在」才照得出来 —— 也就是探针第 3 项。

### 缺陷 2 🔴 折叠光标会「反手取消加粗」

`toggleViaSelection` 原先只看「选区是否被同一个 tag 完整包着」。而**折叠光标**（只是插了个
光标、没选中文字）也满足这个条件：点一下加粗的词，光标落在那个 `<strong>` 里，此时按 `Ctrl+B`
会走**解包**分支 —— 用户以为「加粗整段」，结果那一个词反而被取消加粗了。

- **处置**：`if (range.collapsed) return false;` —— 折叠光标一律走元素级。

### 缺陷 3 `pointerdown` 的 `preventDefault` 阻断 contenteditable 拖选

编辑模式接管指针事件（P0-3 的既定设计），但就地改字时若继续 `preventDefault`，用户就**无法用
鼠标在 contenteditable 里拖选文字** —— 而选区正是「只加粗这一个词」的前提。缺了它，格式按钮
就只剩「整段加粗」一种用法。

- **处置**：`isInsideEditing(e)` —— 正在编辑的那个元素内部的 `pointerdown` / `mousedown` /
  `click` / `mousemove` 全部放行。为此专门加了探针第 14、15 项守这条边界。

## 四、探针自身修掉的假证据（教训）

写探针时踩到四处，都会把「产品是好的」报成失败，或把「崩了」报成通过。记下来免得重演：

1. **按子节点下标定位文本节点会漂移**：包裹一次后 `wrapTextNode` 会切分重建文本节点，
   下标变了 ⇒「解包」那一项选到了段尾的另一个词，去包了个新词，数量当然不是 1。
   **改为按「以某段文字开头」查找文本节点。**
2. **拿「长度 === 4」当判据**：夹具里原有的 `<strong>加粗的词</strong>` 同样正好 4 个字，
   两个都命中 ⇒ 断言恒假。**改为比对具体文本。**
3. **在冒泡阶段读 `defaultPrevented` 会永远读到 `null`**：编辑器的监听在 `document` 捕获上，
   拦截时会 `stopPropagation()`，冒泡阶段的探针监听根本轮不到执行。**改为同节点同阶段
   （`{capture:true}`）注册 —— 注册得晚，天然排在编辑器之后，读到的就是终值。**
4. **在最后一项才 `page.on('pageerror')`**：只能看见那 150ms 内的错误，前面十几步真崩过的
   一条都漏。**改为在第一个 `goto` 之前挂全局收集器。**

通则：**凡「某物应出现」的断言，先确认它出现了，再判断它的属性**；
**凡「应无异常」的断言，监听必须在被验证的时段开始之前就挂上。**

## 五、已知边界（本批次刻意不做）

| # | 边界 | 影响 | 归属 |
|---|---|---|---|
| 1 | ~~**进入就地改字后没有可见的编辑态提示**~~ | ✅ **已关闭**：虚线改字框 + 并列在场，探针第 19–21 项守这条 | 见 §七 |
| 2 | `isFormatOn` 只读内联样式，不读计算样式 | 页面原本靠 class 加粗的元素，第一次点会重复设一次 700（视觉无变化），第二次才取消 | 已定案：换「我写什么就读什么」的可预测性 |
| 3 | 命令持有 `Element` 引用 | 页面重渲染换掉元素后，撤销作用在已脱离文档的旧节点上 | `07` · C1 登记，P0 不处理 |
| 4 | ~~容器类元素（`div` / `section`）双击只选中、不进改字~~ | ✅ **已修正**：改判据后「只装文字的容器」可改，「含块级子元素」才拒绝 | 见 §八 |
| 5 | 跨节点选区（如从半句到下一段之间）不加粗，回落元素级 | `checkSelection` 判 `crossNode` 不合法 | 与旧形态一致 |
| 6 | ~~未做跨载体复跑（系统 Edge）~~ | ✅ **已完成**：Chromium 22/22 · Edge 22/22 | 见 §二 |

## 六、证据文件

- `qa/probes/extension-p0-4.mjs` —— **28 项**断言，可重复执行
- `qa/report/p0-4/01-格式与色板.png` —— 加粗激活 + 色板展开
- `qa/report/p0-4/02-改色后.png` —— 取 `#c0392b` 后正文变红、指示条同步
- `qa/report/p0-4/03-就地改字.png` —— 双击进入改字（**虚线框 + 光标**，与 02 的纯选中态一眼可分）
- `tests/unit/extension-format.test.ts` —— 14 条格式逻辑单测
- `tests/unit/extension-inline.test.ts` —— 13 条容器可编辑性单测（含环境能力快照）

## 七、补记 · 改字态可见反馈（2026-09-23）

原缺口：改字态**没有任何可见提示**，截图里「选中某段」与「正在改这段的字」长得一模一样。
用户看不出自己进了编辑态 ⇒ 也就不知道 Enter 会提交、Esc 会撤销。这不是锦上添花，是认知缺口。

**实现**（三处，均沿用既有分工，未新增机制）

| 文件 | 改动 |
|---|---|
| `anchors.ts` | 新增 `EPX.EDIT_BOX = 'ep-edit-box'`；**不复用** `#ep-selected-box` 加属性 —— 两者必须能同时在场 |
| `ui/overlay.ts` | 第三个框 `#ep-edit-box`；`setEditing(el)` 与 hover/selected 同一套 `apply()` 量测 |
| `inline.ts` | 新增 `InlineEditingHandler`，`start()` / `finish()` 各广播一次「我在改谁 / 改完了」 |
| `content.ts` | `createInlineEditor(commit, (el) => overlay.setEditing(el))` |
| `style/extension.css` | `#ep-edit-box { border: 2px dashed var(--ep-accent); background: none }` |

**两个刻意的设计选择**

1. **与选中框叠加，而非互斥**：改字时实线蓝框仍在场，表示「改的是这一块」；虚线框叠加表示
   「此刻正在改」。只留一层的话，用户仍然无法区分「选中了」与「正在编辑」。
2. **用线型而不是新色号区分**：仓库只有一个强调色（`--ep-accent`），为「正在编辑」再引入
   一个颜色会破坏这套纪律；虚线/实线的对比在截图里一眼可辨。同时只描边不填充 —— 改字时
   用户要看清字，填充会把正文压暗。

**状态同步只有一条路径**：虚线框的出现与消失**只由就地编辑器驱动**。`commit` / `cancel` /
退出编辑模式 / 传位给下一个元素，四条出口都在 `finish()` 里汇成一次 `onEditingChange(null)` ——
调用方不需要（也不应该）在四处各自记得清状态。这是本次唯一新增的机制，成本一行回调。

**顺带修掉的隐患**：原先 `content.ts` 里 `inline` 先于 `overlay` 创建，若改字态回调直接引用
`overlay` 就踩时序；本次把覆盖层提到前面创建，依赖方向变成单向。

## 八、补记 · 「编辑不了容器内的东西」（2026-09-23 用户实测）

用户原话（在真实 `file://` 页面里用完 P0-5 之后）：

> 我编辑好了，保存在桌面上；但是我注意到它编辑不了容器内的东西

### 8.1 根因：判据用了「标签白名单」

`isTextEditable` 原来拿一份**标签白名单**判定可改（`p` / `h1..h6` / `span` / `li` / `td` …）。
`div` / `section` / 自定义元素**都不在名单里** —— 而现实中大量正文就是装在裸 `<div>` / `<section>`
里的。夹具里最显眼的那块文字 `#inner` 正是 `<div>`。

**这是设计缺口，不是用户的操作问题。** 白名单这条路线的根本毛病：它枚举的是「作者打算写什么」，
而我们真正要判的是「这块东西是不是一段文字」——后者是**结构**属性，不是标签属性。

### 8.2 修法：改成结构性判定

唯一闸门 = 「含『有自己盒子』的元素子节点 ⇒ 它是容器 ⇒ 不可改」，前面加两级拦截：

```ts
const NEVER_EDITABLE = new Set(['HTML','BODY','HEAD','SCRIPT','STYLE','LINK','META','TITLE',
  'TEMPLATE','BASE','IMG','INPUT','TEXTAREA','SELECT','OPTION','OPTGROUP','PROGRESS','METER',
  'IFRAME','CANVAS','VIDEO','AUDIO','OBJECT','EMBED','SOURCE','TRACK','MAP','AREA','COL','PARAM',
  'BR','HR']);

export function isTextEditable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;  // SVG / MathML 走 P1
  const tag = el.tagName.toUpperCase();
  if (NEVER_EDITABLE.has(tag)) return false;
  if (hasOwnBoxChild(el)) return false;
  if (TEXT_TAGS.has(tag)) return true;
  return (el.textContent ?? '').trim().length > 0;
}
```

三点值得写下来：

1. **`NEVER_EDITABLE` 必须在结构判定之前拦**。`<img>` 没有子元素、`<textarea>` 的 `textContent`
   是它的默认值 —— 单看结构，这两个都会被误判成「只装文字，可改」。
2. **闸门必须在 `TEXT_TAGS` 快路径之前**。否则 `<li><ul><li>…</li></ul></li>` 会因 `LI` 在快路径里
   而被放行 —— 而它下面明明还有一整块。顺序反了就是另一个 bug。
3. 「有字」是最后一道兜底，用来挡空 `<div>`（没字可改，双击空白处不该进编辑态）。

`hasOwnBox` 从 `pick.ts` 导出复用，保证「选中谁」与「能不能改字」用的是**同一个判据** ——
两处各写一份，迟早会分叉。

### 8.3 🔴 我自己在这里制造的假证据（要如实记）

补完容器矩阵跑基线，得到 **28 项 / 26 通过 / 2 失败**，失败项是：

- `div 叶子块改不了字`（`#inner`）→ **真缺陷**，白名单不含 `DIV`。
- `section 叶子块改不了字`（`#bigbox`）→ **假证据**。

我当时把两条**一起**归因成「白名单缺陷」。实测几何后才发现第二条根本不是：

| 元素 | 盒子 | 几何中心 | 命中栈顶 | 真相 |
|---|---|---|---|---|
| `#outer` | 720×102（上 padding 24） | (633, 535) | `div#inner` | 中心点落在**子块**上 ⇒ 「双击容器」实际测的是「双击子块」 |
| `#bigbox` | 720×528，top=819 | (633, **1083**) | 空栈 | 视口只有 800 高 ⇒ 双击打在**窗口外**，页面什么都没发生 |

两个都是「断言没测到它声称的东西」。第二条尤其阴险：**它长得和产品回归一模一样**，
而且在当时的语境下我的错误归因还自洽（白名单确实不含 `SECTION`）——
如果没去量几何，我就会拿一个错误结论去写报告。

**处置（护栏，而不只是修好这一次）**

- 取点统一先 `scrollIntoViewIfNeeded`，再显式拦住「中心点落在视口外」，报
  「**前提不成立**」而不是静默失败；
- 容器矩阵改用新增的 `dblclickOwn()`：在目标盒内按网格采样，取第一个
  「命中栈顶（剔除编辑器宿主 `#ep-root`）就是它自己」的点。找不到直接报错。

印证了仓库里那条通则：**凡「某物应出现/不应出现」的断言，先确认它作用在了该作用的对象上。**
这次的对象不是 DOM 节点选错了，而是**坐标点选错了** —— 同一类错误的另一种面孔。

### 8.4 环境边界的如实标注

配套单测 `tests/unit/extension-inline.test.ts` 跑在 happy-dom 上，而 happy-dom 的 UA 样式表
**只实现了一部分**（实测）：`div/section/p/h1/ul/li/table` 给得出 `display`，
而 `span/a/strong/em/code/td/th/tbody/caption/img` 一律返回**空字符串**。

真实浏览器永远算得出 `display`（`''` 在真实环境里等于回到初始值 `inline`），
所以这是**测试环境的能力缺口，不是逻辑缺口**。

- **没有**为迁就它去改产品代码 —— 改的依据必须来自真实语义；这里若改（把 `''` 当作「无自己的盒子」），
  会在 `tbody` 那条上引入反向假象（真值 `table-row-group` 是「有盒子」）。
- 处置：把环境能力**本身钉成断言**（第一组用例，名为「能力快照」而不是「前提自检」），
  依赖默认行内样式的用例改为**显式**写 `style="display:inline"` 并在用例名里注明；
  真断言权交给上面的真浏览器容器矩阵。将来 happy-dom 补全了 UA 表，快照会先变红，
  提醒把这批显式样式拆掉。

