# qa/fixtures · 样本页面库（T004）

本目录存放易页 EasyPage 的**回归测试样本**，由 `spikes/_shared/samples/` 原样复制而来（逐字节一致，
禁止直接修改本目录内的 `.html`；如需调整样本须经评审，见任务卡 T004「不在范围」）。

运行 `npm run qa:metrics` 会遍历本目录下所有 `*.html`，按「编辑前 = 编辑后 = 同一文件」跑轻量 DOM diff，
输出 `qa/report/metrics-latest.json`。

## 分类索引

| 文件 | 分类 | 测什么 / 为何收录 |
| --- | --- | --- |
| `01-script-carousel.html` | 脚本轮播 | 含用户自带 `<script>` 与 `onclick` 内联事件；验证**导出必须原样保留用户脚本**、不执行导入态脚本。 |
| `02-shadowdom.html` | ShadowDOM | 含 `#web-component-host` 宿主 + `<template>` 占位；验证 Shadow 宿主按 `block-only` 处理、不可入内。 |
| `03-svg-table.html` | SVG 表格 | 内嵌 `<svg>` 图形与 `<table>` 表格；验证 SVG 子树整体可选中/不可进内编辑、表格结构无损回写。 |
| `04-inline-image.html` | 内联图片 | base64 data-URI 内联图 + 图文混排；验证内联资源不被外泄、`alt`/尺寸属性无损。 |
| `05-ai-landing.html` | AI 生成页 | 典型 AI 生成落地页（nav/header/section/footer）；覆盖 `full` 可编辑元素的主力形态。 |
| `06-malformed.html` | 残缺 HTML | 未闭合标签、IE 条件注释、自闭合 `<br>`、未闭合 `<ul>`；验证解析器容错与回写稳定性。 |
| `07-large.html` | 大页精简版 | 大页代表（生成器注释标记 ~2000 个 `.cell` 的精简壳）；验证度量脚本在大页上的耗时与稳定性。 |
| `08-inline-events.html` | 内联事件安全 | `onload/onclick/onmouseover/onerror` 内联事件 + 表单；验证编辑态不执行脚本、导出保留原始事件属性。 |
| `09-word-fragment.html` | 文本片段 | Word 另存 HTML 片段（`MsoNormal`、`mso-` 内联样式、Office 命名空间）；验证粘贴净化前的原始片段形态。 |
| `10-flex-grid.html` | Flex-Grid 布局 | flex/grid/absolute 混合布局；验证布局容器整体移动、不被重排。 |

## 维护说明

- 命名严格带两位数字前缀（`01-` … `10-`），与 `01-技术基线与接口契约.md §8.1` 的分类约定对齐。
- 样本**只用于测试**，不含真实隐私数据。
- 当前共 10 个样本（Stage 0 基线）；后续卡片可在评审后按类补充至 20–30 个，不得为提高分数而改动既有样本。
