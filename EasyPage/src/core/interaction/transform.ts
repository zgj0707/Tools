// transform 位移纯函数（契约 01 §1 原则 6 / T105）：
// 位移只用 transform: translate，不改 position/top/left/margin。
// 连续拖拽读取并合并当前 translate 分量，保留 scale/rotate，不无限追加 translate() 串。

const TRANSLATE_RE = /translate\([^)]*\)/g;
const MATRIX_RE = /matrix\([^)]*\)/g;

/** 从 inline transform 解析当前 translate 分量（px）。 */
export function parseTranslate(el: Element): { x: number; y: number } {
  const raw = (el as HTMLElement).style.transform || '';
  const m = /translate\(\s*(-?[\d.-]+)px\s*[, ]\s*(-?[\d.-]+)px\s*\)/.exec(raw);
  if (m) return { x: parseFloat(m[1] ?? '0'), y: parseFloat(m[2] ?? '0') };
  const mx = /matrix\([^)]*?(-?[\d.-]+)\s*,\s*(-?[\d.-]+)\s*\)$/.exec(raw);
  if (mx) return { x: parseFloat(mx[1] ?? '0'), y: parseFloat(mx[2] ?? '0') };
  return { x: 0, y: 0 };
}

/** 在当前 translate 上累加 (dx, dy) 写回，保留其他 transform 函数（scale/rotate）。 */
export function applyTranslate(el: Element, dx: number, dy: number): void {
  const cur = parseTranslate(el);
  const nx = cur.x + dx;
  const ny = cur.y + dy;
  const html = el as HTMLElement;
  let existing = html.style.transform || '';
  if (existing === 'none') existing = '';
  existing = existing.replace(TRANSLATE_RE, '').replace(MATRIX_RE, '').trim();
  const parts = existing ? [existing] : [];
  parts.push(`translate(${nx}px, ${ny}px)`);
  html.style.transform = parts.join(' ');
}

/** 清除 translate 分量，保留 scale/rotate 等其他函数；清空则移除 transform。 */
export function clearTranslate(el: Element): void {
  const html = el as HTMLElement;
  const existing = (html.style.transform || '')
    .replace(TRANSLATE_RE, '')
    .replace(MATRIX_RE, '')
    .trim();
  html.style.transform = existing;
}
