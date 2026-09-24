// 拖拽意图判定纯函数（T105）：
// 元素边缘 EDGE_HANDLE_PX 内始终可拖；内部含文本让位于文字选择；无文本元素内部可拖。

import { INTERACTION } from '../../constants';

/** localX/localY 为指针相对元素左上角的像素坐标。 */
export function shouldStartDrag(
  el: Element,
  localX: number,
  localY: number,
  rect: DOMRect,
): boolean {
  const edge = INTERACTION.EDGE_HANDLE_PX;
  // 四边边缘带
  if (localX <= edge || localX >= rect.width - edge) return true;
  if (localY <= edge || localY >= rect.height - edge) return true;
  // 内部：有文本则让位于选字
  const hasText = (el.textContent ?? '').trim().length > 0;
  return !hasText;
}
