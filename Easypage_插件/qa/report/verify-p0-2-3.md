# P0-2 + P0-3 验收记录 · 覆盖层与事件仲裁

> **本批次回答的问题**：插件形态下「点中一个元素」到底能不能真的选中，
> 以及选中框在滚动页面上跟不跟得上。
>
> 这是插件形态**独有**的工程量：旧形态里被编辑文档躺在 `sandbox="allow-same-origin"`
> 的 iframe 里、不执行脚本，插件是那一页里唯一的活动者，不存在「这一击归谁」的问题。
> 插件形态下页面本来就活着，我们和它共用同一个 document —— 于是必须显式仲裁。
>
> **本次不修改任何旧形态代码**（增量并存策略，见 `07` §8）。

## 一、新增与改动

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/extension/pick.ts` | 新增 | 命中归一（纯逻辑，可单测）+ 事件归属判断 |
| `src/extension/ui/overlay.ts` | 新增 | hover / 选中框的绘制与跟随 |
| `src/extension/interaction.ts` | 新增 | 编辑模式的事件仲裁（捕获阶段 + AbortController 统一装卸） |
| `src/extension/anchors.ts` | 改动 | 新增 `OVERLAY` / `HOVER_BOX` / `SELECTED_BOX` 锚点 |
| `src/extension/content.ts` | 改动 | 装配覆盖层与仲裁器，接进模式开关 |
| `src/extension/style/extension.css` | 改动 | `#ep-overlay` 的定位（几何属结构，按铁律放 CSS） |
| `tests/unit/extension-pick.test.ts` | 新增 | 归一规则 17 条单测 |
| `qa/fixtures/pick-page.html` | 新增 | 探针夹具（可滚动、含行内元素、嵌套、表格、大容器） |
| `qa/probes/extension-p0-2-3.mjs` | 新增 | 真浏览器验收 20 项 |

## 二、验收结果

载体：Playwright Chromium（默认）**20/20 PASS**；系统 Edge **20/20 PASS**（跨渠道一致）。

| # | 断言 | 结果 |
|---|---|---|
| 1 | 浏览模式 · 点页面按钮 ⇒ handler 触发 | PASS `data-probe-clicked=yes` |
| 2 | 浏览模式 · 点锚链接 ⇒ 照常跳转 | PASS `(空) → #jump` |
| 3 | 浏览模式 · 覆盖层不出框 | PASS 两者皆不可见 |
| 4 | 进入编辑模式 | PASS `data-ep-mode=edit` |
| 5 | 编辑模式 · 点页面按钮 ⇒ 被接管（不触发） | PASS |
| 6 | 编辑模式 · 点锚链接 ⇒ 不跳转 | PASS `hash 保持 #jump` |
| 7 | **点段落里的 `<strong>` ⇒ 选中整段**（归一） | PASS `(273,384) 720×27 ≈ p` |
| 8 | 嵌套：点内层 ⇒ 选中内层 | PASS `(297,535) 672×27 ≈ inner` |
| 9 | 表格：点单元格 ⇒ 停在 `<td>` | PASS `(273,702) 540×44 ≈ td` |
| 10 | Esc ⇒ 取消选中 | PASS |
| 11 | **hover 与点击选中同一元素** | PASS `(273,384) 720×27 ≈ p` |
| 12 | **大容器 hover ⇒ 只描边不填充**（T123） | PASS `data-fill=false，720×528` |
| 13 | 指针移到工具条 ⇒ hover 清空 | PASS |
| 14 | **滚动后选中框跟随（位移 = 滚动量）** | PASS `上移 200px（滚动 200px）` |
| 15 | 元素出视口 ⇒ 框隐藏 | PASS |
| 16 | 滚回顶部 ⇒ 框重新贴合 | PASS |
| 17 | 退出编辑模式 ⇒ 覆盖层清空 + 页面点击恢复 | PASS |
| 18 | light DOM 未被污染（除 `#ep-root` 外零 `ep-` 节点） | PASS `leaked=0` |
| 19 | 用户文档内容未被改动 | PASS |
| 20 | 零控制台报错 / 零未捕获异常 | PASS |

单测：`tests/unit/extension-pick.test.ts` **17/17 PASS**。

### 门禁复验

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 + 静态检查 + 单测 + 构建 + 许可证 | `npm run check` | **通过**（licenses 扫描 328 包 → PASS） |
| 端到端（串行，旧回归网） | `npx playwright test --workers=1` | **84 passed**（1.2m） |
| P0-2/P0-3 探针 | `node qa/probes/extension-p0-2-3.mjs` | **20/20 PASS** |
| P0-1 探针（回归确认） | `node qa/probes/extension-p0-1.mjs` | **17/17 PASS** |

> `content.ts` 在本批次被改过（接入覆盖层与仲裁器），所以 P0-1 探针专门重跑一遍，
> 确认骨架没有因为新装配而退化。旧 84 用例**一条未改、一条未删** —— 增量并存策略不变。

## 三、落地时修掉的两个缺陷

### 3.1 🔴 `schedule()` 的合并语义写反了（真 bug，会造成 hover 永不出现）

**现象**：click 选中的 9 项断言全绿，hover 的 2 项全红；hover 框始终 `display:none`，
`data-fill` 读到 null（说明 `apply` 从未走到写属性的那一行）。

**取证方式**：写了一次性诊断脚本，两次。第一次用 `document.getElementById('ep-hover-box')`
查 —— 查不到，但那**不是证据**（shadow 内元素用页面上下文的 `getElementById` 必然查不到）。
第二次统一走 `shadowRoot.getElementById`，才拿到真事实：
`#ep-overlay` 存在且 `display:block`（1265×800），两个框存在但 `display:none`。

**根因**：`requestAnimationFrame` 节流写成了「同帧只跑第一个」：

```ts
if (rafId) return;   // ← 第二个调用连同它的参数一起被丢掉
```

而同一帧里常常成对出现 `mouseleave`（置 hover=null）与紧随其后的 `mousemove`（设为新元素）——
用户从工具条上移开鼠标再移进页面时，每一帧都是这个组合。清空赢了，
于是 hover 高亮再也不出现，**而点击selected 一切正常**（它不走这条路径）。
表现为「指着元素没有提示，但点下去又选得中」，是极难归因的一类。

**修法**：改成「后到覆盖先到」—— 用 `pending` 槽位保存**最新**意图：

```ts
pending = fn;
if (rafId) return;
rafId = requestAnimationFrame(() => { rafId = 0; const run = pending; pending = null; run?.(); });
```

### 3.2 ⚠️ 探针断言太弱，把「什么都没发生」判成了通过

**现象**：「大容器 hover 只描边」报 `data-fill=true`，看似是产品缺陷。

**根因**：`#bigbox` 在初始视口之外（中心 y ≈ 1200 > 视口 800）。鼠标坐标派发不到它上面
⇒ hover 被清空 ⇒ 框 `display:none` ⇒ **但 `data-fill` 仍是上一次（段落）留下的 `true`**。
断言只读 `data-fill`、不检查框是否可见，于是把「压根没发生」读成了「结果错」。

**修法**：测前 `scrollIntoViewIfNeeded()`，并**先断言框可见**再断言 `data-fill`；
测完复位滚动，否则后续按视口坐标取点的用例全部错位。

> 这条与批次 1 的教训同源：**弱断言会把「没发生」伪装成「通过」**。
> 凡是「某个东西应该出现」的断言，都要先确认它出现了，再判断它的属性。

## 四、关键设计决定

### 4.1 归一规则（`pick.ts`）

自内向外，首个命中即返回：

1. 编辑器自己的节点 → `null`
2. `html` / `body` → `null`（框住整页给不出任何信息）
3. **SVG 内 → 命中元素本身，不做归一**
4. 第一个「有自己盒子」的元素（`display` 不是 `inline` / `contents`）→ 归一终点
5. 一路都是行内元素 → `null`（宁可不错选，也不选中「半个页面」）

第 3 条是刻意的例外：SVG 里 `<rect>` 的 `display` 计算值是 `inline`，
若一并归一，点矩形会一路向上选到整个 `<svg>` —— 那 P1「拖节点、改连线端点」就无从谈起。

### 4.2 hover 与 click **必须共用**同一归一函数

若两者算法不同，就会出现「我指着 A，选中了 B」——每边单独看都对、只有对照才发现的 bug。
所以 `extension-p0-2-3.mjs` 里专门有一条断言把两者对齐起来比。

### 4.3 滚动跟随不需要补偿滚动量

宿主 `#ep-root` 是 `position:fixed; inset:0`，**它恒等于视口**。
于是元素 `getBoundingClientRect()` 的视口坐标就是覆盖层坐标，
滚动/内容变长都不改变宿主本身 —— 只要重算被标元素的 rect 即可。
（旧形态要减 iframe 偏移、乘缩放比，见 `app/canvas/geom.ts` 的 `frameToOverlay`；
插件形态下那些换算全部消失，这是「没有 iframe」带来的实际收益。）

### 4.4 继承 T123：大容器只描边不填充

直接复用 `app/canvas/geom.ts` 的 `hoverFillAllowed`（面积占比 > 1/4 就不填充）与
`isDocumentRoot`，并让框沿用 `app.css` 里**同名 id**（`#ep-hover-box` / `#ep-selected-box`）——
ID 选择器是顶层规则、不挂在 `#ep-overlay-root` 之下，Shadow DOM 里 id 天然是命名空间，
于是样式零改动复用，包含治「蓝色框盖住整页」的那条 `[data-fill='false']` 规则。

### 4.5 事件仲裁的取舍

**接管**：左键 `pointerdown` / `mousedown` / `click`（三者都要，只拦 `pointerdown` 挡不住
click 的默认行为 —— 链接跳转、表单提交、label 激活）。

**刻意不碰**：右键菜单、中键、滚轮、以及除 `Esc` 外的所有键盘输入。
编辑内容不需要牺牲浏览器的通用能力；抢走方向键/PageDown 只会让人以为页面坏了。

## 五、已知边界（如实登记，未处理）

1. **编辑模式下拖不动页面滚动条**：滚动条上的 `pointerdown` 会被拦。滚轮/触摸板/键盘不受影响。
2. **元素完全滚出视口时框整体隐藏**，而非裁剪到视口边缘显示剩余部分。这是刻意的（避免留下误导性的框），
   但局部可见时也看不到部分边框。
3. **页面重渲染替换掉选中元素 ⇒ 框消失**：`isConnected` 检测会隐藏框，但**不会**尝试在新树上重新定位同名元素。
   这是 `07` · C1 登记的风险，P0 阶段只保证「不画悬空框」。
4. **页面自己的 document 级 capture 监听器若注册更早，仍会先收到事件**：`stopPropagation`
   无法抢在它前面。`preventDefault` 能挡住绝大多数默认行为，但拦不住「已经执行过的副作用」。

## 证据文件

| 文件 | 说明 |
|---|---|
| `qa/report/p0-2-3/01-编辑态-选中段落.png` | 点击段落里的加粗文字 ⇒ 选中框贴合整段（小元素带填充） |
| `qa/report/p0-2-3/02-大容器-只描边.png` | 大容器 hover ⇒ 只有描边（内部淡蓝是页面自身的 `background`） |
| `qa/report/verify-p0-2-3.log` | 门禁与探针原始输出（**本地文件，未入库**：`.gitignore` 含 `*.log`） |
| `qa/probes/extension-p0-2-3.mjs` | 可复跑：`node qa/probes/extension-p0-2-3.mjs` |
| `tests/unit/extension-pick.test.ts` | 可复跑：`npx vitest run tests/unit/extension-pick.test.ts` |
