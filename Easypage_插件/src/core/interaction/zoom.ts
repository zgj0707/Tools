/**
 * 读取编辑帧当前缩放比（批次 1 · R2）。
 *
 * 【唯一来源是 dataset.zoom】
 * ZoomController 在应用缩放时把比值写在 `frame.dataset.zoom` 上；
 * 缩放为 100% 时该属性被删除，本函数回落 1 —— 于是「默认态零 transform」
 * 与「取值为 1」是同一件事，两条路径不会打架。
 *
 * 刻意不用 `getBoundingClientRect().width / offsetWidth` 反推：offsetWidth 是取整后的
 * layout 宽度，反推会引入亚像素误差，而选中框贴合、吸附线落位、手柄拖拽都是
 * 对这套比值敏感的几何计算。
 *
 * 【为什么放在 core/ 而不是 app/】
 * adapters 层的拖拽适配器（吸附线落位）也要读它，而
 * eslint 的 import/no-restricted-paths 禁止 `adapters → app` 的依赖方向。
 * 这是纯 DOM 属性读取的最薄封装，不含任何领域规则，放 core 不破坏分层。
 */
export function zoomOf(frame: HTMLElement | null | undefined): number {
  const raw = frame?.dataset.zoom;
  if (!raw) return 1;
  const z = Number(raw);
  return Number.isFinite(z) && z > 0 ? z : 1;
}
