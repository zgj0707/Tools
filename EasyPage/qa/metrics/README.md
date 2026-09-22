# qa/metrics · 质量度量脚本（T004）

`run-metrics.mjs` 是 Stage 0 的**轻量版**度量入口（Node ESM，仅依赖仓库已装好的 `happy-dom`，
不引入 Playwright / parse5 / 任何新包）。编辑器本体未接入前，它只真实计算当前可计算的两项：
**losslessRate** 与 **residueCount**；**hitRate** 固定为占位 `null`。

调用方式：

```bash
npm run qa:metrics        # = node qa/metrics/run-metrics.mjs
```

产出：
- 控制台打印人类可读简表；
- 写 `qa/report/metrics-latest.json`（结构见文末）。

> 硬红线：本脚本**绝不** import grapesjs / interact.js / moveable；对 `qa/fixtures/*.html`
> 只做「解析 → 规范化 → 逐位比较」，秒级返回。

---

## 一、DOM diff 判定口径（losslessRate 的算法）

对每个样本，把 before / after 两段 HTML 分别用 `happy-dom` 的 `DOMParser.parseFromString(html, 'text/html')`
解析成 Document，再各自展平成一条**规范化 token 流**，然后按下述规则逐位比较。

### 1. 遍历方式
- 文档序前序遍历：`<!DOCTYPE>` → `<html>` 子树（head/body 全部后代）。
- 节点类型映射：
  - `ELEMENT_NODE(1)` → 一个 `ELEM` token；
  - `TEXT_NODE(3)` → 一个 `TEXT` token（纯空白则丢弃，见下）；
  - `COMMENT_NODE(8)` → 一个 `COMMENT` token；
  - 其他（PI / 文档碎片等）→ `OTHER<type>` 占位 token，仅记录不做语义比较。

### 2. 节点规范化
- 元素标签名统一转小写比较（HTML 标签本就大小写不敏感）。
- `<!DOCTYPE>` 只比较 `doctype.name`（`html`），不比较公开/系统标识符。

### 3. 属性规范化（属性排序）
- 取出元素全部属性，按**属性名字典序升序排序**后再参与比较（消除书写顺序差异）。
- 属性值做**空白归一**：把连续空白折叠为单个空格并 trim（见下）。
- 比较单元形如 `ELEM <p> [["class","x"],["id","a"]]`。

### 4. 文本归一与空白处理
- 文本节点内容：连续空白（制表符/换行/多空格）折叠为单个空格，再 trim；
  若结果为空串，则**整个文本节点丢弃**（即纯空白节点不参与比较）。
- 注释节点内容同样做空白折叠后保留（注释也算节点，参与比较）。
- 这样，仅因换行/缩进/排版造成的空白差异不会被判为差异，符合契约 §8.2「忽略空白差异」。

### 5. 一致率与首个差异位置
- 设两 token 流长度为 `lenB / lenA`，总比较单元数 `total = max(lenB, lenA)`。
- 逐位 `tokensB[i] === tokensA[i]` 计数为 `matched`。
- **losslessRate = matched / total**（任一侧缺节点即记为不一致，长度差本身扣分）。
- 首个差异位置：第一个 `tokensB[i] !== tokensA[i]` 的下标 `i`，并在 JSON `notes` 中给出
  before / after 两侧 token 原文，便于定位。
- 跨样本汇总时，**totals.losslessRate = Σ matched / Σ total**（合并 token 流，而非对样本取平均）。

> 当 before 与 after 是同一文件（Stage 0 现状），两次解析结果必然逐位一致，losslessRate 自然为
> `1.0`——这是 happy-dom 真实解析 + 真实比较的结果，不是编造。

---

## 二、三项指标定义

### 1. losslessRate（无损率，真实计算）
- 口径：见上「一」。当前 before = after = 同一文件，基线应为 `1.0000`。
- 未来接入编辑器后，对「导入后不做任何编辑直接导出」的产物跑同一比较，衡量回写保真度。

### 2. residueCount（残留数，真实计算）
- 对 **after HTML 原文**做六类正则全局匹配，命中数相加：

  | 口径 | 正则 | 说明 |
  | --- | --- | --- |
  | `data-ep-` | `/data-ep-/g` | 编辑器注入的临时属性 |
  | `class="ep-` | `/class="ep-/g` | 编辑器外壳类名（带 `class="` 前缀） |
  | `ep-overlay-root` | `/ep-overlay-root/g` | 覆盖层根容器 id |
  | `contenteditable` | `/contenteditable/g` | 就地编辑临时属性 |
  | `<style id="ep-` | `/<style\s+id="ep-/g` | 编辑器注入的 `<style>` |
  | `<script id="ep-` | `/<script\s+id="ep-/g` | 编辑器注入的 `<script>` |

- per-fixture 的 `residue` 只列出命中数 > 0 的类别（`{kind, count}`），未命中为空数组。
- 契约要求导出残留**必须为 0**，否则导出阻断；当前样本为原始页面，基线 `residueCount = 0`。

### 3. hitRate（命中率，占位 null）
- 契约 §8.2 定义：能完成「改 h1 → 调色 → 位移(10,8) → 撤销 → 重做 → 预览 → 导出」且导出含预期改动
  的样本占比。
- **当前编辑器尚未接入（T101 之后才接通）**，无法真实测量，故 `hitRate` 固定为 `null`，
  JSON 与控制台均显式标注「未接入编辑器，hitRate 基线为占位 null」。**严禁编造任何命中率数字。**

---

## 三、输出 JSON 结构

```jsonc
{
  "generatedAt": "2026-09-21T...Z",
  "totals": { "hitRate": null, "losslessRate": 1.0, "residueCount": 0 },
  "perFixture": [
    {
      "id": "01-script-carousel",
      "category": "脚本轮播",
      "hit": null,
      "losslessRate": 1.0,
      "residue": [],
      "notes": "编辑前=编辑后=同一文件，lossless 为真实解析后逐位比较；与原始一致"
    }
  ],
  "notes": "未接入编辑器，hitRate 基线为占位 null；……"
}
```

## 四、维护说明
- 本目录只放脚本与本文档；样本只放 `qa/fixtures/`；报告只放 `qa/report/`。
- 后续 T101 / T115 接通编辑器与预览后，在本脚本内把 `hit` 与未来的 `previewConsistency` 由 `null`
  改为真实计算，不得改动本文件已冻结的 diff / residue 口径。
