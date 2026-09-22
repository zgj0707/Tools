# qa/metrics · 质量度量脚本（T004 → Playwright 操作级升级）

`run-metrics.mjs` 是样本库质量度量的**门禁入口**（Node ESM）。契约 §8.2 原文承诺的
「T101 有真实编辑能力后，由 Playwright 跑『固定操作脚本』补全 hitRate；residue 升级为 §8.3 的
DOM 级纯函数清理」在本版本**已兑现**：

- `hitRate`：由 Playwright 驱动**真实 UI** 的固定操作脚本取数，是实数（0..1），不再是占位 `null`；
- `losslessRate`：对「导入后不做任何编辑直接导出」的产物与原始样本做规范化逐位比对（契约 §8.2 原文口径）；
- `residueCount`：在**真实浏览器**中 `DOMParser` 解析导出 HTML 后做 DOM 级判定（不再用六条正则）；
- 原 happy-dom 静态能力保留在报告 `static` 字段，**明确不参与门禁判定**。

调用方式：

```bash
npm run qa:metrics                     # = node qa/metrics/run-metrics.mjs
npm run qa:metrics:update-baseline     # 追加 --update-baseline：把本次结果写为合入前基线
```

产出：

- 控制台打印人类可读简表（逐样本 hit / lossless / residue / 失败原因）；
- 写 `qa/report/metrics-latest.json`（结构见「四」）；
- 首次运行（或带 `--update-baseline`）写 `qa/report/metrics-baseline.json`（同结构，作为「合入前基线」载体）。

`.gitignore` 只放行这两个 JSON：`qa/report/*.json` 被忽略，`metrics-baseline.json` 与
`metrics-latest.json` 例外入库。

> 硬红线：本脚本**绝不** import grapesjs / interact.js / moveable；不引入任何新 npm 包
> （只用仓库已装的 `playwright`（含 chromium）、`vite`、`happy-dom`）。
> 本脚本只依赖稳定 DOM 契约（按钮可见文案、`#ep-canvas-frame`、`#ep-overlay-root [data-dir="se"]`、
> `#ep-preview-frame`、`.ep-box input[type=number]`、`[data-ep-editing]`），不依赖任何内部实现细节。

---

## 一、固定操作脚本（写死在脚本里，可复现）

对每个样本按序执行，全部通过且导出含预期改动才算 **hit**：

| # | 操作 | 驱动方式 |
| --- | --- | --- |
| 1 | 粘贴导入 | `textarea.fill(源) + 「导入 HTML」` |
| 2 | 改文本 | 双击文本目标（`H1..H6/P/BUTTON/SPAN/LI/A` 白名单按优先级取第一个可见者）→ `fill(标记)` → Enter |
| 3 | 改背景色 | 选中方块目标 → 样式面板背景色控件提交 `#123456` |
| 4 | 移动 | 合成 PointerEvent 拖拽 (10, 8)（两次 `pointerdown`：第一次选中并 attach 适配器，第二次启动拖拽） |
| 5 | 缩放 | 样式面板写显式 `120px/80px` → 重选触发手柄重算 → 拖 `se` 手柄 (+40, +30) |
| 6 | 撤销 | 焦点移出画布后 `Ctrl+Z` |
| 7 | 重做 | `Ctrl+Shift+Z` |
| 8 | 切预览 | 「预览」开 → 校验预览态含标记文本 → 再点「预览」关 |
| 9 | 导出 | 「导出 HTML」并捕获导出文件 |

选择器与手势写法与既有 e2e（`tests/e2e/startpage.spec.ts` / `inline-edit.spec.ts` /
`drag.spec.ts` / `resize.spec.ts` / `preview.spec.ts`）同源，避免另造一套不可信驱动方式。

## 二、三项门禁指标定义

### 1. hitRate（命中率，真实计算）
- 口径（契约 §8.2 原文）：**能成功完成上述全部固定操作、且导出包含预期改动（标记文本 / 位移 /
  缩放尺寸）的样本数 ÷ 总样本数**。
- 逐样本还落盘每步是否成功、失败原因、导出 diff 摘要（见「四」）。

### 2. losslessRate（无损率，真实计算）
- 口径（契约 §8.2 原文）：对**「导入后不做任何编辑直接导出」**的产物与原始样本做规范化
  token 逐位比对（忽略空白差异、属性书写顺序），取一致率；
  跨样本汇总为 **Σ matched / Σ total**（合并 token 流，而非对样本取平均）。
- 与旧版的本质差别：`before` 是**磁盘上的样本原文**、`after` 是**真实经导入→导出往返后的产物**，
  不再是把同一个字符串 parse 两次的构造性自比对。
- 规范化算法见「三」。

### 3. residueCount（残留数，DOM 级真实计算）
- 在真实浏览器内 `new DOMParser().parseFromString(导出HTML, 'text/html')`，逐个元素判定：
  - 任何 `data-ep-*` 属性（含 `data-ep-editing`）；
  - 类名以 `ep-` / `ep__` 开头（编辑器外壳 BEM 类名）；
  - `id === "ep-overlay-root"`；
  - 存在 `contenteditable` 属性；
  - 编辑器注入的 `<style id="ep-*">` / `<script id="ep-*">`。
- 契约要求**必须为 0**，否则导出阻断；本脚本把它作为门禁硬条件。
- **判别力自检**：脚本先对一段人造脏 HTML（五类注入物各一）跑同一个检测函数，
  必须五类全部命中；自检不过 → 门禁直接判失败（防止「检测器空实现导致永远为 0」）。

### 4. editedRoundTripFidelity（补充口径，非契约原有项）
- 「导出前的编辑态 DOM」↔「导出产物」的 token 一致率，即**导入→编辑操作→导出**这条真实链路上
  的导出回写保真度。两侧均不计 `DOCTYPE` token（`documentElement.outerHTML` 天然不含 doctype，
  导出产物带 `<!DOCTYPE html>` 前缀，不对齐会让 token 流整体错位一位）。
- 该项用于补充说明编辑链路的保真度，**不参与门禁判定**。

### 5. 门禁判定（报告 `gate` 字段）
- `residueCount` 必须为 0，且残留检测自检必须通过；
- `hitRate`、`losslessRate` **不得低于** `metrics-baseline.json` 中的数值；
- 任一项不满足 → `gate.result = "fail"` 且**退出码为 1**；
- 基线文件不存在时 → `no-baseline`（只记录不判定），并在本次运行写入基线。

## 三、静态对照口径（report `static`，**不参与门禁**）

保留 T004 原有 happy-dom 能力，作为对照数据：

对每个样本，把「样本原文」与「未编辑往返导出的产物」两份 HTML 分别用 happy-dom 的
`DOMParser.parseFromString(html, 'text/html')` 解析成 Document，各自展平成一条**规范化 token 流**，逐位比较：

1. **遍历**：文档序前序遍历 `<!DOCTYPE>` → `<html>` 子树；`ELEMENT_NODE(1)` → `ELEM` token、
   `TEXT_NODE(3)` → `TEXT` token（纯空白丢弃）、`COMMENT_NODE(8)` → `COMMENT` token。
2. **节点规范化**：标签名小写；`<!DOCTYPE>` 只比较 `doctype.name`。
3. **属性规范化**：属性按**名字典序升序**排序后比较；属性值做空白折叠 + trim。
4. **文本归一**：连续空白折叠为单个空格再 trim；结果为空串则整个文本节点丢弃（即忽略纯排版空白差异）。
5. **一致率**：`total = max(lenB, lenA)`，`losslessRate = matched / total`；跨样本汇总为 Σmatched/Σtotal。

`static.totals.residueCount` 仍用原六条正则（`data-ep-` / `class="ep-` / `ep-overlay-root` /
`contenteditable` / `<style id="ep-` / `<script id="ep-`）统计，仅作对照。

## 四、输出 JSON 结构

```jsonc
{
  "generatedAt": "2026-09-22T...Z",
  "durationMs": 15172,
  "mode": "playwright-ui-ops",
  "definitions": {
    "contractSource": "docs/plan/01-技术基线与接口契约.md §8.2 / §8.3",
    "contractText": { /* 契约原文逐条引用：fixedOpScript / hitRate / losslessRate / residueCount / stripList */ },
    "fixedOperationScript": [ /* 固定操作脚本 9 步 */ ],
    "hitRate": "…口径说明 + 契约原文引用…",
    "losslessRate": "…",
    "residueCount": "…",
    "editedRoundTripFidelity": "…",
    "staticMetrics": "…不参与门禁…"
  },
  "totals": {
    "hitRate": 1,
    "losslessRate": 0.888,
    "residueCount": 0,
    "editedRoundTripFidelity": 1,
    "samples": 10,
    "hitSamples": 10
  },
  "static": { "participatesInGate": false, "totals": { /* … */ }, "perFixture": [ /* … */ ] },
  "residueDetectorSelfTest": { "ok": true, "expected": 5, "actual": 5, "kinds": [ /* 五类 */ ] },
  "gate": { "result": "pass", "checks": [ /* 逐条检查 */ ], "failed": [] },
  "perFixture": [
    {
      "id": "01-script-carousel",
      "category": "脚本轮播",
      "hit": true,
      "allOpsOk": true,
      "opResults": { "editText": { "ok": true, "detail": "…" }, "setBg": {}, "move": {}, "resize": {}, "undo": {}, "redo": {}, "preview": {}, "export": {} },
      "failReasons": [],
      "exportDiff": { "hasExport": true, "exportedLength": 812, "expectedChanges": { "hasMarker": true, "hasTransform": true, "hasResized": true, "hasBg": true }, "summary": "editText:ok setBg:ok …" },
      "residue": { "total": 0, "hits": [] },
      "losslessRate": 0.8571,
      "roundTrip": { "losslessRate": 0.8571, "matched": 78, "total": 91 },
      "editedRoundTripFidelity": 1,
      "boxes": { "preset": { "width": "120px", "height": "80px" }, "resized": {}, "undo": {}, "final": {} },
      "notes": "文本目标=<h2>；方块目标=<div>"
    }
  ]
}
```

## 五、维护说明

- 本目录只放脚本与本文档；样本只放 `qa/fixtures/`；报告只放 `qa/report/`。
- 新增样本时**无需改脚本**：目标元素由脚本在页面内按「能力 + 可见 + 标签白名单」自动挑选。
- 固定操作脚本的改动必须同步更新本文件「一」与契约 §8.2 的口径记录；
  静态对照口径（「三」）为 T004 冻结口径，不得改动。
- 脚本运行需要能启动 vite dev server（自动选端口，`strictPort: false`）与 chromium（`playwright` 已装浏览器）。
