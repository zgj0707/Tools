// 盒模型/外观 CSS 互转纯函数（T109）。纯函数可单测，不碰 DOM。

export interface ShadowParts {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/** 解析 "10px 5px 3px 2px rgba(0,0,0,.3)" → ShadowParts；none/空 → null。 */
export function parseShadow(css: string): ShadowParts | null {
  const t = css.trim();
  if (!t || t === 'none') return null;
  // 提取颜色（最后一个 token，可能带逗号/rgb()/rgba()）
  const colorMatch = /(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}|\w+)$/.exec(t);
  const color = colorMatch ? (colorMatch[1] as string) : 'rgba(0,0,0,0.2)';
  const nums = t.slice(0, colorMatch ? colorMatch.index : t.length).match(/-?\d*\.?\d+(?:px)?/g) ?? [];
  const n = (i: number) => parseFloat(nums[i] ?? '0') || 0;
  return { x: n(0), y: n(1), blur: n(2), spread: n(3), color };
}

/** 拼装 "x y blur spread color"；null → ''（表示移除内联，而非空串残留）。 */
export function buildShadow(p: ShadowParts | null): string {
  if (!p) return '';
  return `${p.x}px ${p.y}px ${p.blur}px ${p.spread}px ${p.color}`;
}

/** 解析 "16px" → 16；非 px 返回 null。 */
export function parsePx(cssLength: string): number | null {
  const m = /^(-?\d*\.?\d+)px$/i.exec(cssLength.trim());
  return m ? parseFloat(m[1] as string) : null;
}

/** margin/padding 为 0 是有效重置：保留 "0px"，不当冗余删除。 */
export function isKeepableZero(prop: string, value: string): boolean {
  if (!/^(margin|padding)/.test(prop)) return false;
  const n = parseFloat(value);
  return Number.isFinite(n) && n === 0;
}

/** width/height 回填口径：仅显式 inline px 返回数字字符串；%/auto/calc/rem/vw/空 一律返回 ''。 */
export function inlineSizeValue(inline: string): string {
  const n = parsePx(inline);
  return n === null ? '' : String(n);
}
