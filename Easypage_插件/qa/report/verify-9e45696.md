# 提交树 `9e45696` 门禁复验记录

> **为什么有这份记录**：`2f242c4`（`wip(ui): 批次 1 落地 —— e2e 4 红`）在提交时，工作区里
> 一个并行的 writer 正在改 `qa/probes/batch1-debug.mjs`，导致 `git add` 之后文件又变了
> ⇒ **`2f242c4` 的「4 红」状态并未在其自身的提交树上被验证过**（当时的红对应提交前 8 分钟的那棵树）。
> 这份记录就是补上这一步：在 HEAD `9e45696` 上重跑全套，把真实结果如实归档。
>
> **本次复验不修改任何源码**。

## 被测目标

- **commit**：`9e45696`（`docs(qa): 批次 1 实机对照截图与对照报告页`）
- **工作区**：干净（`git status --short` 无输出）
- **时间**：2026-09-22 18:54:58 → 18:59 前后，全程**串行**（并发期不启动任何浏览器）

## 结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型 + 静态检查 + 单测 + 构建 + 许可证 | `npm run check` | **通过** |
| 端到端（串行） | `npx playwright test --workers=1` | **84 passed**（1.4m） |
| 度量门禁 | `npm run qa:metrics` | **gate: pass** |
| 常驻体检探针 | `node qa/probes/batch1-debug.mjs` | **全部通过（16 项）** |

### 明细

```
npm run check
  vitest          Duration 6.04s (tests 265ms, environment 39.14s)
  vite build      ✓ 63 modules transformed
                  dist/index.html  135.37 kB │ gzip: 39.05 kB
  check:licenses  扫描 328 个包 → PASS：无禁止许可

npx playwright test --workers=1
  84 passed (1.4m)

npm run qa:metrics
  totals: hitRate=1  losslessRate=0.888  residueCount=0
          editedRoundTripFidelity=1  samples=10
  static(不参与门禁): losslessRate=0.888  residueCount=0
  gate: pass

node qa/probes/batch1-debug.mjs   （需先 npm run dev -- --port 4173）
  ① 画布高度链路
     1280×720  画布 608×520 · 视口下沿留白 50px · 外壳纵向溢出 无      → 4 项 PASS
     1440×900  画布 768×744 · 视口下沿留白 50px · 外壳纵向溢出 无      → 4 项 PASS
  ② 选中态不推动画布
     初始 / 选中 h2 后 工具条带均 h=82、画布 y=150                          → 5 项 PASS
  ③ 预览开关与状态时序                                                  → 5 项 PASS
```

## 结论

1. **`2f242c4` 记录的「4 红」在 `9e45696` 上已全部消失**，即批次 1 收口提交 `79fe3dd`
   的修复是有效的。`wip-batch1-20260922` 这个 tag 指向的仍是「4 红」那棵树，
   **描述依然成立，无需改写**；它的价值在于记录「批次 1 首次落地的真实状态」，而非当前状态。
2. 三项门禁 **均不劣于基线**：hitRate=1（基线 1）、losslessRate=0.888（基线 0.888）、
   residueCount=0（基线 0）。构建体积 135.37 kB 仍超 130 kB 预算 5.37 kB（既有遗留，非本批引入）。

## 证据文件

| 文件 | 说明 |
|---|---|
| `qa/report/verify-9e45696.log` | 原始输出（**本地文件，未入库**：`.gitignore` 含 `*.log`；shell `echo` 段为 GBK 编码，中文显示为乱码，数字与英文段可读） |
| `qa/report/probe-batch1.log` | 探针原始输出（UTF-8，可读；同样未入库） |
| `qa/report/ui-refactor-p1/` | 批次 1 实机对照取证（截图 + 对照报告页 + 机读清单，已入库） |
