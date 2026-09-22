# ADR-002 · 移除 Moveable，交互手势全自研

- 状态：Accepted（Stage 2 第 0 步，纯减法 + 正名）
- 日期：2026-09-21
- 取代：ADR-001 §2 中「Moveable 采用（首选）」一行
- 关联：T105 拖拽微移、T106 8 向缩放、T107 对齐吸附

## 1. 背景

T105 引入 `moveable@0.53.0 (MIT)` 作为 `InteractionAdapter` 实现，承担选中框、8 向手柄、拖拽/缩放/吸附的指针交互。我们的结构是「被编辑页面在隔离 iframe、编辑器外壳在 `#ep-overlay-root`」——**拖拽目标元素在编辑 iframe 内，控制器在外壳**。

## 2. 实证问题（技术诚实）

- 在该跨 realm 结构下，**真实鼠标 `pointerdown` 后的 `pointermove` 在编辑 iframe 内不可靠**：Playwright 真实 `page.mouse.down()/move()` 序列会挂起（30s timeout），疑似浏览器跨 iframe 指针/选择态。
- 最终 T105 拖拽、T106 缩放、T107 吸附的手势均改用**浏览器内合成 `PointerEvent` + 原生 pointer 监听**完整实现并跑通真实 Chromium e2e。
- 此时 moveable 在 `{draggable:false, resizable:false}` 下**仅用于画选中框**，而选中框/8 手柄本就由 `OverlayLayer` 自绘——moveable 与自绘重复，却把主 bundle gzip 从约 4kb 推到约 91kb。
- **未深入实现 Moveable 官方 `iframeManager` 接法**（跨 realm 挂载的官方路径）。

## 3. 决策

移除 `moveable`，`InteractionAdapter` 改由自研 `SelfInteractionAdapter` 实现。已验证的原生 pointer 逻辑全部保留：attach 幂等、死区（DRAG_DEAD_ZONE_PX=5）、Shift 单轴、rAF 写 `transform:translate`、committed 才回调 push 一个 MoveCommand、`showGuides/clearGuides` 画吸附线。

## 4. 理由

- 自研手势已完整通过真实 Chromium e2e（drag/resize/snap 全绿），边际收益不抵约 91kb(gzip) 体积与跨 realm 集成维护成本。
- interact.js 免费版对跨 iframe 官方支持有限、多 iframe 为 Pro 商业授权，故排除。
- 选中视觉（选中框/8 手柄/吸附线）由 `OverlayLayer` 自绘，移除 moveable 框后不缺失（e2e 把关）。

## 5. 影响

- bundle 主 JS gzip 回落（见 Stage 2 第 0 步回归 build 输出）。
- SBOM 移除 moveable 运行时依赖；ADR-001 对应行标注「已被 ADR-002 取代（移除）」，保留历史不删。
- `src/core/**` 交互纯函数（transform/dragIntent/resize/resizeGuard/snap）与全部命令不变。

## 6. 后续

若需多点触控/复杂手势（rotate、stretch、group 拖拽等），可重新评估第三方库，**但须先做 Moveable `iframeManager` 或 interact.js 的限时 PoC**，确认跨 realm 真实拖拽可靠后再引入。
