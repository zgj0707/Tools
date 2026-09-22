# 易页 EasyPage · 依赖清单（SBOM）

> T001 首版。仅登记本卡批准安装的工具链与运行时依赖；编辑器交互 / 就地编辑 / 粘贴净化等
> 运行时依赖待 T002 选型 PoC、T003 冻结白名单后补登。
> 版本 / 许可为 `npm install` 后 `node_modules/<pkg>/package.json` 实测值；
> 「传递依赖数」为该包依赖闭包中的包数量（各包闭包互相重叠，非可加）。
> 许可准入：仅 MIT / BSD / Apache-2.0 / ISC 等宽松许可；禁 GPL / AGPL / SSPL。

## 运行时依赖（dependencies）

| 包 | 版本 | 许可 | 用途 | 传递依赖数 |
| --- | --- | --- | --- | --- |
| idb | 8.0.3 | ISC | IndexedDB 草稿存储封装（契约 §2） | ≈0 |
| parse5 | 7.3.0 | MIT | Node/qa 侧 HTML 规范化解析与 diff（契约 §2） | ≈1 |
| ~~moveable~~ ~~0.53.0~~ ~~MIT~~ | **已移除（ADR-002）** | ~~拖拽/缩放选中框适配器（T105）~~。Stage 2 第 0 步因跨 realm 真实拖拽不可靠 + 体积过大（gzip ~91kb）整体卸载，交互全自研（`SelfInteractionAdapter`）。历史保留不删。 | ≈23（已随卸载移除） |

## 开发依赖（devDependencies）

| 包 | 版本 | 许可 | 用途 | 传递依赖数 |
| --- | --- | --- | --- | --- |
| typescript | 5.9.3 | Apache-2.0 | 语言 / strict 编译（契约 §2） | ≈0 |
| vite | 6.4.3 | MIT | 构建 / 开发服务器（契约 §2） | ≈21 |
| vitest | 3.2.7 | MIT | 单元测试框架（契约 §2） | ≈68 |
| @vitest/coverage-v8 | 3.2.7 | MIT | Vitest 覆盖率（卡片 step2；卡片原文 `@vitest/coverage-vitest` 为笔误，npm 无此包，已纠正为官方 `@vitest/coverage-v8`） | ≈101 |
| happy-dom | 15.11.7 | MIT | Vitest DOM 环境（契约 §2） | ≈3 |
| @playwright/test | 1.63.0 | Apache-2.0 | E2E 与样本库度量驱动（契约 §2） | ≈2 |
| eslint | 8.57.1 | MIT | 静态检查（契约 §2；钉 v8 以使用 `.eslintrc.cjs`，ESLint v9 默认 flat config 不认该文件） | ≈97 |
| @typescript-eslint/parser | 8.70.0 | MIT | ESLint 的 TS 解析器 | ≈110 |
| @typescript-eslint/eslint-plugin | 8.70.0 | MIT | ESLint 的 TS 规则集 | ≈113 |
| eslint-plugin-import | 2.32.0 | MIT | import 边界 no-restricted-paths（契约 §3） | ≈212 |
| prettier | 3.9.8 | MIT | 代码格式化（契约 §2） | ≈0 |

## 备注

- 全量安装包数（lockfile `packages` 条目，含根）：413。
- 本轮**未**安装任何编辑器交互/就地编辑/净化库（Moveable / interact.js / Tiptap / Lexical / DOMPurify / GrapesJS 等均为 T003 范围）。
- 以上许可均为宽松许可，符合准入；T003 冻结时需把各依赖 LICENSE 文本归集到 `third-party/LICENSES/` 并在 `NOTICE.md` 登记。
