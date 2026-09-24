// 格式刷纯函数（T110）：固定白名单收集源样式 → 产出可写内联 props。纯函数不碰 DOM。
// 注意：浏览器 computed style 的简写属性 padding/border/borderRadius 通常为空串，
// 真值在 longhand（paddingTop…、borderTopWidth/Style/Color、borderTopLeftRadius…），
// 因此这三项须从 longhand 拼装。

/** 卡面逐字白名单（16）。严禁布局/定位类属性。 */
export const STYLE_WHITELIST = [
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'textDecoration',
  'textAlign',
  'lineHeight',
  'letterSpacing',
  'borderRadius',
  'border',
  'boxShadow',
  'opacity',
  'padding',
  'textShadow',
] as const;

export type StylePropName = (typeof STYLE_WHITELIST)[number];

/** 四边 CSS 简写归一：单值/两值/四值。 */
function quad(t: string, r: string, b: string, l: string): string {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

export interface BoxLonghands {
  paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string;
}
export interface RadiusLonghands {
  borderTopLeftRadius: string; borderTopRightRadius: string;
  borderBottomRightRadius: string; borderBottomLeftRadius: string;
}
export interface BorderLonghands {
  borderTopWidth: string; borderTopStyle: string; borderTopColor: string;
}

/** 从 padding 四边 longhand 拼 padding 简写。 */
export function assemblePadding(p: BoxLonghands): string {
  return quad(p.paddingTop, p.paddingRight, p.paddingBottom, p.paddingLeft);
}

/** 从 radius 四角 longhand 拼 border-radius 简写。 */
export function assembleRadius(r: RadiusLonghands): string {
  return quad(
    r.borderTopLeftRadius, r.borderTopRightRadius,
    r.borderBottomRightRadius, r.borderBottomLeftRadius,
  );
}

/** 从 border-top longhand 拼 border 简写；无边框（none/0 宽）返回 null 不收集。 */
export function assembleBorder(b: BorderLonghands): string | null {
  if (b.borderTopStyle === 'none' || b.borderTopWidth === '0px' || b.borderTopWidth === '0') {
    return null;
  }
  return `${b.borderTopWidth} ${b.borderTopStyle} ${b.borderTopColor}`.trim();
}

/** 从 computed style 取白名单值（padding/border/borderRadius 走 longhand 拼装）。 */
export function collectStyles(css: CSSStyleDeclaration): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of STYLE_WHITELIST) {
    if (k === 'padding') {
      out.padding = assemblePadding({
        paddingTop: css.paddingTop, paddingRight: css.paddingRight,
        paddingBottom: css.paddingBottom, paddingLeft: css.paddingLeft,
      });
      continue;
    }
    if (k === 'borderRadius') {
      out.borderRadius = assembleRadius({
        borderTopLeftRadius: css.borderTopLeftRadius,
        borderTopRightRadius: css.borderTopRightRadius,
        borderBottomRightRadius: css.borderBottomRightRadius,
        borderBottomLeftRadius: css.borderBottomLeftRadius,
      });
      continue;
    }
    if (k === 'border') {
      const b = assembleBorder({
        borderTopWidth: css.borderTopWidth,
        borderTopStyle: css.borderTopStyle,
        borderTopColor: css.borderTopColor,
      });
      if (b) out.border = b;
      continue;
    }
    const v = css[k as keyof CSSStyleDeclaration];
    if (typeof v === 'string' && v !== '' && v !== 'none' && v !== 'normal') {
      out[k] = v;
    }
  }
  return out;
}

/** 产出可写内联 props：键恰好等于白名单（computed 规范化字符串直接写）。 */
export function buildStyleProps(source: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of STYLE_WHITELIST) {
    if (source[k] !== undefined && source[k] !== '') out[k] = source[k];
  }
  return out;
}
