# Third-Party Notices（NOTICE）

> 本文件为占位（T001）。T003 冻结技术基线时，需把本产品引入的所有开源依赖的
> LICENSE 文本归集到 `third-party/LICENSES/`，并在此逐项登记许可与致谢声明。

## 状态

- T001：仅落地工程脚手架与无争议工具链，第三方依赖清单见 `docs/plan/依赖清单(SBOM).md`。
- 编辑器交互 / 就地编辑 / 粘贴净化等运行时依赖（Moveable / interact.js / Tiptap / Lexical / DOMPurify 等）
  尚未引入，待 T002 选型 PoC、T003 冻结白名单后再补登。

## 许可准入原则

- 仅允许 MIT / BSD / Apache-2.0 / ISC 等宽松许可；禁止 GPL / AGPL / SSPL。
- MPL / LGPL 需调度者 / 法务确认后方可引入。
