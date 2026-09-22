# 前端走查问题清单（T122）

> 触发：用户反馈「当前前端非常非常乱」。本轮不改视觉风格（配色 / 字体 / 组件造型保持现状），
> 只修**交互与呈现组织**上的混乱。
>
> 走查方式：真实 Chromium 逐场景操作 + 截图 + 几何自动检测。工具与产物：
> - `qa/audit/walkthrough.mjs` —— 16 个场景（含 1 个 1024×820 窄视口场景），每场景截图 + 注入式审计函数
> - `qa/audit/shots/*.png` —— 逐场景截图
> - `qa/audit/report.json` —— 机读结果（截断 / 零尺寸 / 越界 / 重叠 / 遮挡 / 区域溢出 / 可滚动性）

---

## 0. 走查结果对照

| 场景 | 修复前异常项 | 修复后异常项 |
|---|---|---|
| 01-empty（空态） | 0 | 0 |
| 02-imported-canvas-first | 0 | 0 |
| **03-panels-open（双面板展开）** | **12 截断 + 1 越界** | **0** |
| 04 ~ 15（其余 12 个场景） | 0 | 0 |
| **16-narrow-panels-open（1024×820 窄视口 + 多选）** | **2 遮挡 + 1 区域溢出（溢出 145px）** | **0** |
| **合计** | **16** | **0** |

修复前的具体形态：
- 12 项「文字被截断」集中在图层面板 —— 标签被挤成 `nav…` / `di…` / `h…`
- 1 项「越界」是样式面板高度 1261px 超出 900px 视口
- 窄视口那 3 项是对齐条溢出画布列 145px，末两个按钮被右侧样式面板盖住（详见 §1.4）

> 场景 16 是**为了这个 bug 专门补的**：默认视口 1440×900 下对齐条放得下，问题不暴露；
> 1180 时画布列约 508px，仍刚好放得下；1024 才真正溢出。位置与视口宽度强相关，
> 所以「走查全绿」在补这个场景之前是**假绿**。

---

## 1. P0 —— 直接破坏可用性

### P0-1 样式面板撑破视口，底部内容不可达

**证据**（走查 03-panels-open）
```
.ep-panel   height=1261px   viewport=900px   overflowY=visible
页面总高被推到 1321px；三栏高度 469 / 439 / 1261 严重失衡
```
**根因**：`.ep-panel` 声明了 `width: 220px` 但没有任何高度约束，内容多高它就多高。面板内部没有滚动容器，超出视口的部分没有任何路径可以到达。

**修复**（`src/app/style/app.css`）
```css
.ep-panel {
  max-height: calc(100vh - var(--ep-topbar-h) - var(--ep-sp-3));
  overflow-y: auto;
}
```

---

### P0-2 图层树标签被压成 1 个字

**证据**（走查 03-panels-open）：260px 面板被 6 个内联 emoji 按钮（98px）+ 行间距（24px）吃掉后，标签只剩 `nav…` / `di…` / `h…`。

**修复**（`src/app/style/app.css`）：面板宽 200 → 260px；行内 `gap` 3 → 2px。
> `max-height: 600px` 保持不变 —— 那是 `layers.spec` 断言的性能红线（15000 节点首屏行数有界）。

---

### P0-3 首屏底部悬着一个空的深色药丸

**证据**：`qa/audit/shots/01-empty.png` 底部中央有一个空药丸。

**根因**：`.ep-toast` 没有默认隐藏。空 `textContent` 的 div 仍有 padding + 背景 + 圆角，于是首屏就渲染出一个无文字的药丸。另有一个连带问题 —— `toast()` 只写文案、从不隐藏，**任何一次提示都会永久驻留**，后续提示直接叠字。

**修复**
- `src/app/style/app.css`：`.ep-toast` 默认 `opacity: 0; visibility: hidden`，靠 `[data-open='true']` 显隐；两个状态都保留 `translateX(-50%)` 居中位移
- `src/app/App.ts`：`toast()` 设 `data-open` 并启动自动收起计时器
- `src/constants.ts`：新增 `UI.TOAST_VISIBLE_MS = 2600`（契约要求不写魔法数字）

---

### P0-4 对齐条溢出画布列，末两个按钮被样式面板盖住、点不到

**证据**（走查 16-narrow-panels-open，1024×820，双面板展开 + 2 元素多选）
```
.alignbar         x=436  w=497  → 右边界 933  flex-wrap=nowrap
.ep-canvas-col    x=436  w=352  → 右边界 788（父容器内容盒宽 352）
aside.ep-panel    x=788          ← 样式面板从这里开始
⇒ 对齐条超出父容器右侧 145px，正好压在样式面板下面

elementFromPoint(末位按钮中心点) 命中 <h3>「样式」，不是按钮本身
```
**根因**：`.ep-alignbar` 是 `flex: 0 0 auto` + 默认 `flex-wrap: nowrap`，宽度完全由 8 个按钮决定（实测 497px），**不受画布列约束**。视口越窄、画布列越窄，溢出越多。

**为什么这是功能缺陷而不是观感问题**：被盖住的「水平等距 / 垂直等距」中心点被样式面板接管，**点了没有任何反应，而且界面上看不出来** —— 按钮明明画在那里。

**修复**（`src/app/style/app.css`）：`flex-wrap: wrap` + `max-width: 100%`。超宽时自动换行（1024 下变两行），任何视口宽度下 8 个按钮都可达；视口够宽时仍是一行的胶囊造型，观感不变。

---

## 2. P1 —— 误导与不一致

### P1-1 四个排序按钮文案完全相同

**证据**：图层面板连续四个按钮的可见文字是 `↑ ↑ ↓ ↓`（置顶 / 上移 / 下移 / 置底），肉眼无法区分功能。

**修复**（`src/app/panels/layers/LayersPanel.ts`）：改用 `⤒ ↑ ↓ ⤓`（U+2912 / U+2191 / U+2193 / U+2913），并给四个按钮及 lock / hide 补 `title`。

---

### P1-2 对齐按钮没有禁用态，与图层 ↑↓ 两套口径

**证据**：8 个对齐 / 分布按钮在任何选中状态下都呈可用外观，点了才弹「对齐需要至少 2 个元素」；而图层面板的 ↑↓ 按钮用 `disabled` 表达同一类前提。同一产品里两种处理方式，且前者属误导（看起来能点）。

**修复**（`src/app/App.ts`）：新增 `alignButtons[]` 与 `setAlignButtonsEnabled(count)` —— 对齐类阈值 2、分布类阈值 3；在 selection 变更回调与 `mount()` 结尾调用。

**用例同步**（`tests/e2e/multi-select.spec.ts`）：原用例断言「点了不产生副作用」，改写为「根本不可点」：
```ts
await expect(alignLeft).toBeDisabled();                       // 无选中
await editFrame.locator('#c1').click();
await expect(alignLeft).toBeDisabled();                       // 单选 1 个
await editFrame.locator('#c2').click({ modifiers: ['Shift'] });
await expect(alignLeft).toBeEnabled();
await expect(distH).toBeDisabled();                           // 2 个：对齐可用，分布仍禁用
await editFrame.locator('#c3').click({ modifiers: ['Shift'] });
await expect(distH).toBeEnabled();                            // 3 个：分布放开
```
> 这是本轮**唯一**被改写的既有断言。断言口径收紧而非放宽。

---

### P1-3 原生 file 控件把英文露在界面上

**证据**：导入浮层底部渲染出 `Choose File` / `No file chosen`。i18n 里 `'button.chooseFile': '选择文件'` 存在但**从未被任何代码引用**。

**修复**（`src/app/App.ts` + `app.css`）：原生控件视觉隐藏（1px + opacity:0 + pointer-events:none），用自定义「选择文件」按钮代理触发。
> ⚠️ 控件必须留在 DOM 中 —— `startpage.spec.ts` 用 `setInputFiles()` 直接喂文件，该 API 不要求元素可见。

---

### P1-4 短视口下画布列纵向溢出，面包屑被推到折叠线下（本轮只记录，未修）

**证据**（同一份走查数据，视口 1024×720）
```
.ep-canvas-col  y=60   h=682  → 底 742
#ep-breadcrumb  y=714  h=28   → 底 742   ← 超出 720 视口
viewport.scrollH = 742 > 720            ← 页面被撑出 22px 滚动
```
**根因**：画布 iframe 内联固定 `height: 600px`（几何红线），加上对齐条 38px + 面包屑 28px + 间距，画布列总高恒为 682px。视口高度低于 **742px** 时必然溢出。（1366×768 的笔记本减去浏览器 chrome 后正好落在这个区间。）

**为什么本轮不动**：`height: 600px` 是拖拽 / 缩放 / 吸附用例的坐标基准，改动面波及 `snap.spec` / `resize.spec`，风险高于收益；且它不影响任何控件的可达性（页面只是能滚动 22px）。

**可选的后续方向**：把画布列改为 `min-height: 0` + 内部滚动，或让画布高度按可用高度自适应（需同步校准几何用例）。**注意走查场景 16 刻意取 820 高**，就是为了把这条独立问题和水平溢出分开，避免混在一个断言里。

---

## 3. P2 —— 组织与语义

### P2-1 草稿行把四类信息挤在一行

标签 + 文件名 + 时间戳 + 按钮挤在一起互相挤占。拆为 `.ep-draft__label` / `__name`（可省略号）/ `__time` / `__actions`（`margin-left:auto`）。

---

### P2-2 样式面板标签中英混杂

**证据**：分组标题是中文（「盒模型」「外观」），字段标签却是 `width` / `height` / `margin-top` / `border-width` / `radius` / `opacity` / `shadow-blur`；而同一个面板上方的文字属性区又是中文（字体 / 字号 / 字重 / 文字颜色）。

**修复**
- `src/app/i18n/zh-CN.ts`：补 30 条词条，盒模型四向用「上外边距 / 上内边距」这类规范中文
- `src/app/panels/style/BoxModelSection.ts` / `DecorationSection.ts`：标签走 `t()`
- `src/app/panels/style/fields.ts`：新增 `hintField()`，把英文 CSS 属性名挂到 `label.title` —— 面板文案统一中文，精确属性名 hover 仍可查
- `border-style` 的四个选项本地化为 无 / 实线 / 虚线 / 点线（`value` 仍是 CSS 关键字，提交与回填逻辑不变）

---

### P2-3 阴影开关语义自相矛盾，且在勾选态下静默失效

**证据**：勾选框文案是「**无阴影**」，勾上 = 移除阴影（`checked = !sh`）；但五个阴影输入**不随开关禁用**，所以在勾选状态下改「模糊」或「扩散」会静默 no-op —— `rebuild()` 里读到 `checked === true` 后直接 `commit('boxShadow', '')`。

**修复**（`src/app/panels/style/DecorationSection.ts`）
- 语义反转为「阴影」（勾上 = 启用）
- 未勾选时五个阴影子项 `disabled`，可用性 = 未整体禁用 且 开关已勾
- 首次启用且四向全 0 时补一组可见默认值（Y=2 / 模糊=8），避免「勾上却看不见任何变化」

---

### P2-4 无选中态：面板只置灰、不清值

**证据**：`refresh()` 在 `els.length === 0` 时 `setAllDisabled(true)` 后**直接 return**，字段保留上一次选中元素的值。初装上（从未选中过）则显示各 `<select>` 的**首选项**与 `#000000` —— `system-ui` / `400` / `#000000` 并非当前状态，是控件默认值冒充状态。

**修复**
- `src/app/panels/style/StylePanel.ts`：新增 `clearAll()`，空态时清空全部显示值 + 显示空态说明
- 空态说明用新增的中性色 `.ep-notice[data-kind='info']`，与红色的能力守卫提示区分（`showNotice(msg, kind)`）
- `fields.ts` 的 `makeSelect` 增加 `setEmptyText()`：空选项文案随上下文切换 —— 多选值不一致时是「混合」，未选中时是「—」
- `fields.ts` 的 `makeColor` 增加 `data-unset`：`input[type=color]` 无法表达空值，空值/无共有值时降级显示，避免用旧色冒充当前值（这条同时修掉了「多选颜色不同时静默显示 #000000」）
- `BoxModelSection.clear()` / `DecorationSection.clear()` 供上面调用

---

### P2-5 右键菜单把「删除」放在第一项

破坏性操作的误点概率最高。修复（`src/app/ContextMenu.ts` + `App.ts`）：
- 顺序改为 复制 → 重置位移 → 锁定/解锁 →〔分隔线〕→ 删除
- `ContextMenuItem` 新增 `danger` / `separatorBefore`，新增 `.ep-menu-sep` 与 `.ep-menu-item[data-danger='true']`

---

## 4. P3 —— 契约与技术债

### P3-1 ElementsPanel 硬编码中文

**证据**：`'插入'` / `'删除选中'` / `'项目符号列表'` / `'编号列表'` / `'取消列表'` 直接写在 TS 里，违反契约 01 §3/§9「代码中只引用 key，不硬编码中文字符串」。

**修复**：新增 4 条 `panel.elements.*` 词条并改用 `t()`。取消列表复用已有的 `panel.style.unlist`。
> ⚠️ 这几个字串是 `list.spec.ts` 的 `getByRole` 定位锚点，词条值必须与原文案逐字一致（本轮已确保）。

---

### P3-2 就地编辑态没有任何视觉反馈

双击进入 `contenteditable` 后除了文本光标没有任何提示，用户不知道当前处于编辑态、也不知道 Esc 可取消。

**修复**（`src/app/canvas/CanvasHost.ts`）：画布文档加载时注入 `style#ep-inline-edit-style`，给 `[data-ep-editing]` 一条虚线强调色外框（与外壳的**实线**选中框区分）。
> 两点安全性已验证：① `outline` 不参与布局，不影响 e2e 的坐标基准（拖拽 / 缩放 / 吸附）；
> ② 该 `<style id="ep-*">` 会被导出清理的第 ④ 类规则摘除（`core/serialize/stripArtifacts`），`startpage.spec.ts` 的「导出无 `ep-`」断言即为回归护栏。

---

### P3-3 label 与控件没有 for/id 关联

`fields.ts` 的 `wrap()` 建了 `<label>` 和控件但从不关联，屏幕阅读器无法把它们配对，`getByLabel` 也不可用。
**修复**：`wrap()` 自动分配 `id` 并设 `lab.htmlFor`（外壳节点，不进被编辑文档）。

---

## 5. 判定为「设计红线」，本轮不动

| 项 | 判定依据 |
|---|---|
| 画布 iframe 内联 `height: 600px` | 几何红线 —— 拖拽 / 缩放 / 吸附的坐标基准，改动会波及 `snap.spec` / `resize.spec`。**代价见 P1-4**：短视口（<742px 高）下画布列纵向溢出 22px |
| `.ep-layers { max-height: 600px }` | 性能红线 —— `layers.spec` 断言「15000 节点首屏行数有界」 |
| `sandbox="allow-same-origin"`（不含 `allow-scripts`） | 安全设计。**编辑态脚本不执行是特性不是缺陷**，浏览器控制台的 `Blocked script execution in 'about:srcdoc'` 是它生效的证据 |

---

## 6. 附：走查工具自身的坑（记录以免重复踩）

### 6.1 审计逻辑的坑

| 坑 | 事实 |
|---|---|
| 用 `getComputedStyle().display` 判可见性 | **只看自身**，祖先 `display:none` 时子元素仍报 `block`。曾因此误报 71 项「零尺寸」。正确 API 是 `el.checkVisibility({ checkOpacity, checkVisibilityCSS })` |
| 「超出视口」当成异常 | 对**可滚动**容器是正常的，只有「超出且不可滚动」才够不到。`out.scrollables` 里用 `clipped` 表达后者 |
| 只查同区域内部两两重叠 | **查不到跨区域遮挡**。对齐条压在样式面板下就是这么漏掉的 —— 几何上没越界、没截断，看着只是「排得有点挤」。必须用 `elementFromPoint(中心点) === 自己` 判可达性（新增 `covered` 检查） |
| 遮挡检查里跳过 `disabled` 控件 | 「跳过 disabled」是第一版的写法，**恰好把要抓的目标跳掉了**：1024 视口下溢出的正是「水平等距 / 垂直等距」，而 2 元素选中时分布类按钮就是 disabled。被遮挡的 disabled 按钮同样是缺陷信号（说明容器已溢出）。现已不跳过，并在记录里带上 `disabled` 字段 |
| 只靠命中测试判溢出 | 命中测试受 disabled 与坐标影响。补一条纯几何的 `regionOverflow`：直接量「区域矩形有没有超出父容器内容盒」。两条互补，本次两条都命中且指向同一处（`alignbar over {right:145}`） |
| 全屏模态打开时的遮挡 | 导入浮层是模态，它盖住下面的顶栏属预期，会让 `covered` 产生海量噪声。已加 `modalOpen` 守卫；右键菜单 / 链接气泡 / 提示条按瞬态浮层白名单排除 |

### 6.2 环境与交互的坑

| 坑 | 事实 |
|---|---|
| 真实鼠标 `down/move` 跨 iframe | **在本环境会挂起**（`tests/e2e/drag.spec.ts` 注释已记录）。必须用合成 `PointerEvent` |
| iframe 内元素的 `boundingBox()` | 已经是主页面视口坐标，**不能再叠加 iframe offset**（叠加后鼠标会跑到屏幕外） |
| headless 下的敏感权限 | 剪贴板 / 文件 / 下载在 headless 可能停在 `prompt`，**真实窗口才是 `granted`**。剪贴板类结论必须以 `--headed` 为准，否则会报出不存在的缺口 |
| 单场景卡住拖垮整轮 | 每个场景必须包 `withTimeout()` |
| 走查与 e2e 用的不是同一套产物 | **e2e** 走 `playwright.config.ts` 的 `webServer`（`npm run dev`）= **源码**；**走查**自己 `spawn vite preview` = **`dist` 产物**。所以改了 CSS/TS 后：跑 e2e 不用 build，跑走查**必须先 build**，否则测的是旧包（本文件里的「修复前/后」对照就是靠这个差分离出来的） |

---

## 7. 回归基线

| 门 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `eslint --max-warnings=0` | 通过 |
| 单测 | 176 / 176 |
| e2e（`--workers=1` 串行） | 66 / 66 |
| 走查 16 场景 | 16 / 16，异常项 0 |

> ⚠️ e2e **并发**跑会出现不稳定失败（两次并发运行得到**完全不同的**失败集合）。
> 定位过程：写复现探针验证被怀疑的功能完全正常，再用 `--workers=1` 复跑全绿 ⇒ 并发偶发。
> 结论：本项目 e2e 结论以串行为准；并发模式下的失败不要直接当成回归。
>
> ⚠️ 另有一条**已被证伪**的误判值得记下来：本轮曾出现「草稿续开」用例单独跑 5/5 全过、
> 全量跑却失败。真正的根因不是并发，而是我自己引入的一个 `ReferenceError`（见 §8）——
> **「单独跑过、全量跑不过」不必然是跨用例干扰。**

---

## 8. 本轮最大的一个误判（记录以免重演）

`playwright.config.ts` 的 webServer 用的是 `npm run dev -- --port 4173`，第 42 行注释已写明
「用 dev server 启动应用，**e2e 不依赖先执行 build**」。也就是说 **e2e 跑的是源码，不是 `dist`**，
而 Vite dev server **不做类型检查**。

事故链：
1. 新增提示条自动收起时写成 `TOAST_VISIBLE_MS`，实际导出的是 `UI.TOAST_VISIBLE_MS` → `tsc` 报 `TS2304`。
2. e2e 不检查类型 ⇒ 应用照常加载；`tsc` 失败只让 `npm run build` 跳过 `vite build`，而 e2e 根本不读 dist。
3. 报错点恰好落在 `saveDraft()` 的 `toast('toast.draftSaved')` 上，**下一行才是 `this.refreshDraftList()`**
   ⇒ 后续语句从未执行，症状是「Ctrl+S 后草稿行仍显示『无草稿』」——一条跟 toast 看起来毫无关系的失败。
4. 单独复跑 5/5 全过（因为复跑前 TS 错误已经修掉了），把方向进一步带偏到「并发 flaky」。

**三条可复用的判据**
- 改完源码**先跑 `tsc --noEmit`，再跑 e2e**。顺序反了会把「编译错误」误诊成「功能回归」。
- 症状是「某条语句之后的行为没发生」时，先看**那条语句之前有没有可能抛异常的调用**，而不是怀疑那条语句。
- 归因前先确认「这次跑的产物到底是源码还是 dist」——拿错前提会推出完全错误的结论。
