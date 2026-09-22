// 文字属性 CSS 映射纯函数（契约 01 §4 SetStyleCommand；T108）。
// 字体白名单固定系统栈，不加载网络字体；纯函数可单测，不碰 DOM。

export const FONT_FAMILY_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'system-ui, sans-serif', label: 'system-ui' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: '"Times New Roman", Times, serif', label: 'Times' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Courier New, monospace', label: 'Courier' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
];

export const FONT_WEIGHT_CHOICES: ReadonlyArray<string> = ['400', '500', '600', '700'];

export const TEXT_ALIGN_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'left', label: 'left' },
  { value: 'center', label: 'center' },
  { value: 'right', label: 'right' },
  { value: 'justify', label: 'justify' },
];

/** 多选共有值：全部相同返回该值，否则 null（面板显示"混合"占位）。 */
export function commonValue(values: string[]): string | null {
  if (values.length === 0) return null;
  const first = values[0] as string;
  return values.every((v) => v === first) ? first : null;
}

/** 解析 "16px" → 16；非 px 返回 null。 */
export function parsePx(cssLength: string): number | null {
  const m = /^(-?\d*\.?\d+)px$/i.exec(cssLength.trim());
  return m ? parseFloat(m[1] as string) : null;
}

/** 行高：computed 可能是 "1.5" 或 "24px"；统一返回数值（px 则除基准字号不做，控件直接显示该数）。 */
export function parseLineHeight(css: string): number | null {
  const t = css.trim();
  if (t === 'normal') return null;
  const px = parsePx(t);
  if (px !== null) return px;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 两次内联样式快照的差异：返回 next 中与 initial 不同（或 initial 无）的 prop→value。 */
export function diffProps(
  initial: Record<string, string>,
  next: Record<string, string>,
): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [k, v] of Object.entries(next)) {
    if (initial[k] !== v) changed[k] = v;
  }
  return changed;
}
