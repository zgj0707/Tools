// 导入安全消毒（T119）。纯函数，正则移除危险属性，保留用户原始 <script>。

export function sanitizeImport(html: string): string {
  let out = html;
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/(href|src|xlink:href)\s*=\s*"javascript:[^"]*"/gi, '');
  out = out.replace(/(href|src|xlink:href)\s*=\s*'javascript:[^']*'/gi, '');
  return out;
}
