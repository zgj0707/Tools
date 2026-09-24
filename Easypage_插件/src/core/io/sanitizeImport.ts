// 导入安全消毒（T119）。纯字符串实现，不引第三方库、不 parse DOM。
//
// 定位：纵深防御里的「清洗」一道，「隔离」一道在 iframe sandbox：
//   - 编辑帧 sandbox="allow-same-origin"（无 allow-scripts）⇒ 导入的脚本不执行
//   - 预览帧 sandbox="allow-scripts"（无 allow-same-origin）⇒ 执行但与宿主不同源
// 本函数只处理「会被带进导出产物、导出后可能被用户直接上线」的危险标记：
//   1) 事件处理器属性 on*（单引号 / 双引号 / 无引号三种写法）
//   2) 危险协议的 URL 属性（javascript: / vbscript: / data:text/html，含实体与空白混淆）
//   3) srcdoc（可注入完整文档，绕过外层 sandbox 的属性清洗）
//   4) <meta http-equiv=refresh> 与 <base>（劫持导航、改写相对路径解析）
//   5) 内联 style 里的 expression() 与 javascript: 协议
// 明确保留：用户原始 <script>（契约要求无损保留；其不执行由 sandbox 保证）。

const URL_ATTRS = 'href|src|xlink:href|action|formaction|poster|background|dynsrc|lowsrc|data';
const URL_ATTR_RE = new RegExp(
  `\\s(?:${URL_ATTRS})\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>\`]+))`,
  'gi',
);
const STYLE_ATTR_RE = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;

/** 去掉所有不可见字符（空白与控制符）——用于拆掉 `java\tscript:` 这类混淆。 */
function stripInvisible(s: string): string {
  return Array.from(s)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c > 0x20 && c !== 0x7f;
    })
    .join('');
}

/** 先解掉常见混淆（实体编码、空白/控制字符），再判断是否危险协议。 */
export function isDangerousUrl(raw: string): boolean {
  let v = stripInvisible(raw);
  v = v.replace(/&#x([0-9a-f]{1,6});?/gi, (_m: string, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  v = v.replace(/&#([0-9]{1,7});?/g, (_m: string, d: string) =>
    String.fromCharCode(parseInt(d, 10)),
  );
  v = v.replace(/&(?:tab|newline|colon|sol);/gi, '');
  return /^(?:javascript|vbscript|data:text\/html|data:application\/xhtml\+xml)/i.test(v);
}

export function sanitizeImport(html: string): string {
  let out = html;
  // 1) 事件处理器属性（三种引号写法）
  out = out.replace(/\son[a-z0-9_:-]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z0-9_:-]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z0-9_:-]+\s*=\s*[^\s"'>`]+/gi, '');
  // 2) srcdoc
  out = out.replace(/\ssrcdoc\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\ssrcdoc\s*=\s*'[^']*'/gi, '');
  // 3) 危险协议 URL
  out = out.replace(
    URL_ATTR_RE,
    (match: string, _all: string, dq?: string, sq?: string, uq?: string) =>
      isDangerousUrl(dq ?? sq ?? uq ?? '') ? '' : match,
  );
  // 4) 内联 style 危险表达式
  out = out.replace(STYLE_ATTR_RE, (match: string, _all: string, dq?: string, sq?: string) =>
    /expression\s*\(|(?:javascript|vbscript)\s*:/i.test(dq ?? sq ?? '') ? '' : match,
  );
  // 5) 导航 / 基址劫持
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  out = out.replace(/<base\b[^>]*>/gi, '');
  return out;
}
