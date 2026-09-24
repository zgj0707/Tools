# 02 · 任务卡 · Stage 0（决策与基建）

> 卡片统一字段：目标 / 类型·复杂度 / 依赖 / 开工前读 / 产出文件 / 实现步骤 / 验收命令 / 手动验收 / 不在范围 / 停下求助。
> 🔴 决策型只能由资深/强模型执行；🟢 实现型可派给低水平模型。每张卡一个分支一个 PR。

---

## T001 · 工程脚手架与质量门禁　🟢 / M

- **目标**：从零搭好可运行、可测试、可构建、带 import 边界约束的空工程，`npm run check` 全绿。
- **依赖**：无（首张卡）。
- **开工前读**：`README` §3–§5、`01` §2–§3、§10。
- **产出文件**（按 `01` §3 目录）：`package.json`、`vite.config.ts`、`tsconfig.json`、`.eslintrc.cjs`、`.prettierrc`、`.gitignore`、`index.html`、`src/main.ts`、`src/constants.ts`（先放 `01` §6 常量）、各空目录带 `.gitkeep`、`tests/unit/smoke.test.ts`、`tests/e2e/smoke.spec.ts`、`third-party/NOTICE.md`（占位）。

- **实现步骤**：
  1. `npm create vite@latest . -- --template vanilla-ts`（在仓库根，目录已存在则按提示合并）。
  2. 仅安装**无争议工具链**（编辑器交互/编辑库本卡不装）：devDependencies：`typescript vite vitest @vitest/coverage-vitest happy-dom @playwright/test eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-import prettier`；dependencies：`parse5 idb`。安装后记录每个包版本与 License 到 `docs/plan/依赖清单(SBOM).md`（表头：包/版本/许可/用途/传递依赖数）。
  3. `tsconfig.json` 开 `strict:true`、`noUncheckedIndexedAccess:true`、`forceConsistentCasingInFileNames:true`。
  4. 按 `01` §10 补齐 scripts：`dev/build/preview/typecheck/lint/format/test/test:watch/e2e/check/qa:metrics`（`qa:metrics` 先指向 T004 将建的脚本，未建前允许 echo 占位并在 PR 注明）。
  5. ESLint 加 `eslint-plugin-import` 的 `no-restricted-paths`：
     - `src/core/**` 禁止 import 第三方包与 `../adapters/**`、`../app/**`；
     - `src/app/**` 禁止 import 第三方交互/编辑库（可先按包名前缀建空规则，T003 补全）。
  6. 建 `01` §3 的完整目录骨架（空目录放 `.gitkeep`）。
  7. `src/main.ts` 仅做：挂载一个 `#ep-app` 根节点并写入文案 key 渲染的 "易页 EasyPage"（文案从 `src/app/i18n/zh-CN.ts` 取，先建该文件含 `app.title`）。
  8. `tests/unit/smoke.test.ts`：断言 `INTERACTION.DRAG_DEAD_ZONE_PX === 5`；`tests/e2e/smoke.spec.ts`：打开首页断言出现"易页 EasyPage"。
  9. `.gitignore`：`node_modules`、`dist`、`qa/report/*.json`（保留 `.gitkeep`）、Playwright 产物。
  10. `npx playwright install chromium`（仅 Chromium）。

- **验收命令（须全绿）**：`npm run typecheck`、`npm run lint`、`npm run test`、`npm run e2e`、`npm run build`、`npm run check`。
- **手动验收**：`npm run dev` 打开浏览器，页面显示"易页 EasyPage"，控制台无红色报错。
- **不在范围**：任何编辑器功能；安装 Moveable/interact/Tiptap/DOMPurify 等（T003 后按白名单）。
- **停下求助**：脚手架模板与 `01` 目录冲突；某工具链 License 不是宽松许可；import 边界规则无法按描述配置。

---

## T002 · 开源选型 PoC（PRD 6.0）　🔴 / L　【仅资深 / 强模型】

- **目标**：用统一证据回答"画布交互库、就地编辑、净化等用开源还是自研"，产出可评审的 ADR 与评分，**不允许凭印象定**。
- **依赖**：T001。
- **开工前读**：PRD v0.2 §6.0–§6.8、`01` §1–§2、§5、§7。
- **产出文件**：`docs/plan/adr/ADR-001-技术选型.md`、`docs/plan/adr/选型评分表.md`、`spikes/` 下每个候选一个最小 PoC（可在评审后删除，不进 `src/`）。

- **执行步骤（决策型，按方法而非按代码模板）**：
  1. 建候选短名单（至少）：交互 **Moveable vs interact.js vs 自研 transform**；就地编辑 **自研 contentEditable 收敛 vs Tiptap vs Lexical**；净化 **DOMPurify（许可确认）vs 自研白名单**；整页框架 **GrapesJS（重点证伪其"无损编辑任意已有 HTML"能力）**。
  2. 用 T004 同期产出的 **同一批代表性样本（先取 8–10 个覆盖各类）**，对每候选跑统一动作：导入保真 → 改字 → 调色 → transform 位移 → 撤销 → 干净导出 → 未改动 diff。
  3. 按 PRD 6.0 的 7 个维度逐项打分（1–5）并记录证据：①任意 HTML 无损解析/回写 ②transform 微移且保留文档流 ③导出干净度/运行时依赖 ④撤销/预览/覆盖层现成度 ⑤可嵌入与改造工作量 ⑥License 与社区活跃度 ⑦体积性能。
  4. 记录让候选跑通所需的**实际改造工时与卡点**；对 GrapesJS 明确写出它是否要求把页面转成其组件模型、能否无损回写第三方 DOM。
  5. License 核查：打开每个候选及其关键传递依赖的仓库 LICENSE，给"可闭源商用 / 需法务确认 / 不可用"结论。
  6. 每个候选给出"整合 / 仅取局部 / 放弃自研"建议，并对"整合"项定义 adapter 接口到库 API 的映射。
  7. 套用退出标准（PRD 6.0）：需大规模重写、License 不兼容、命中率低于自研基线、社区停摆其一即降级/放弃。

- **验收（评审门）**：评分表每格有证据链接/PoC 路径；ADR 含决策、否决理由、License 结论、回退方案；至少 1 名资深人工签字。
- **不在范围**：把选型代码合入 `src/`（T003 才落 adapter 空壳）；改 PRD 范围。
- **停下求助**：两个候选分差小且涉及架构分歧；某许可无法定性；GrapesJS 能力与预期相反需调整路线。

---

## T003 · 冻结技术基线与接口契约　🔴 / M　【仅资深 / 强模型】

- **目标**：把 T002 结论固化进 `01` 文档与工程，使 Stage 1 可以"照契约开工"。
- **依赖**：T002。
- **开工前读**：`01` 全文、ADR-001、评分表。
- **产出文件 / 动作**：
  1. 更新 `01-技术基线与接口契约.md`：把所有「PoC 待定」替换为最终选择与版本；如接口签名据 PoC 调整，直接改 §4 并升文档小版本。
  2. 生成最终依赖白名单，写入/定稿 `docs/plan/依赖清单(SBOM).md`，补全传递依赖与许可；建 `third-party/LICENSES/` 存放各依赖 LICENSE 文本、更新 `NOTICE.md`。
  3. 安装入选运行时依赖；在 `src/adapters/<域>/` 建**适配器空壳类**（`implements` §4 端口，方法先 `throw new EditorError('EP.NOT_IMPLEMENTED')`），在 `platforms/web/composition.ts` 完成注入装配。
  4. 补全 ESLint import 边界到可执行（把入选第三方包名纳入"仅 adapters/platforms 可 import"规则）。
  5. 完成 `01` §11 冻结检查单全部勾选。

- **验收（评审门）**：`npm run check` 全绿；空壳适配器装配后应用仍能启动；契约文档无「待定」；SBOM 与 NOTICE 齐全；评审签字。
- **不在范围**：实现任何适配器的具体行为（后续卡片）。
- **停下求助**：PoC 结论要求改动 §4 核心接口（需先评审接口变更）。

---

## T004 · 样本页面库 + 质量度量脚本　🟢 / M

- **目标**：建立客观"裁判"，输出首版 `metrics-latest.json`（命中率/无损率/残留数）。
- **依赖**：T001（脚本框架）、T003（序列化清理规则定稿；若并行可先用 §8.3 规则实现）。
- **开工前读**：`01` §8、§4 中 `HtmlIO`/`SerializeResult`。
- **产出文件**：`qa/fixtures/**`（20–30 个样本）、`qa/scripts/run-metrics.ts`、`qa/scripts/clean-rules.ts`（或复用 `src/core/serialize`）、`qa/report/.gitkeep`、`tests/unit/clean-rules.test.ts`。

- **实现步骤**：
  1. 按 `01` §8.1 分类建样本，每类 2–3 个、总计 20–30；样本为自造/公开许可的最小代表页（可脚本生成重复节点的大页），命名严格带数字前缀；每个样本同目录可放 `<name>.meta.json` 描述预期可编辑元素选择器。
  2. `clean-rules.ts` 实现 §8.3 清理为**纯函数** `stripEditorArtifacts(doc): EditorArtifact[]`，并对 5 类注入物各写单测（构造带标记 DOM，断言被清除且返回残留清单）。
  3. `run-metrics.ts`（Playwright 驱动真实应用；应用未具备编辑能力前，先实现 **lossless 与 residue** 两项，hit/preview 留接口返回 `null` 并在 T101 后接通）：
     - **residue**：对导出 HTML 用正则/解析统计 `data-ep-`、`class="ep-`、`ep-overlay-root`、`contenteditable`、`<style id="ep-`、`<script id="ep-` 命中数。
     - **lossless**：导入→不编辑→导出，用 parse5 分别规范化序列化，按节点/属性/文本比较，输出一致率与首个差异位置。
     - **hit / preview**：定义操作脚本与断言骨架（选择器取 meta.json；改文本/背景/位移/撤销/重做/预览/导出），在 T101、T115 后分别启用。
  4. 输出 JSON schema：`{generatedAt, gitSha, totals:{hitRate,losslessRate,residueCount,previewConsistency}, perFixture:[{id, category, hit, losslessRate, residue:[...], notes}]}`；同时打印人类可读表。
  5. `npm run qa:metrics` 接到 package.json；在 `qa/report/metrics-baseline.json` 固化首版基线（评审确认）。

- **验收命令**：`npm run qa:metrics` 退出码 0 并生成 JSON；`npm run test`（含 clean-rules 单测）全绿。
- **手动验收**：人为往某样本副本注入一个 `data-ep-x` 再导出，确认 residueCount ≥1 且该样本被判失败。
- **不在范围**：实现编辑器功能；为提升分数而修改样本"放水"（样本固定后改动需评审）。
- **停下求助**：parse5 规范化与浏览器序列化差异导致 lossless 计算口径不清；Playwright 无法驱动 iframe 内文档。
