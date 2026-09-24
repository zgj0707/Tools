// DOM 解析/序列化适配器（契约 01 §4 HtmlIO）。
// parse 用浏览器原生 DOMParser；serialize 走 outerHTML + stripEditorArtifacts + 残留检测。
// 本适配器在 adapters/ 下，可访问浏览器 DOM API。

import type {
  HtmlIO,
  ParseResult,
  ParseWarning,
  ResourceRef,
  SerializeOptions,
  SerializeResult,
} from '../../core/ports';
import {
  collectResidue,
  stripEditorArtifacts,
} from '../../core/serialize/stripArtifacts';

export class DomParserIO implements HtmlIO {
  parse(source: string): ParseResult {
    const doc = new DOMParser().parseFromString(source, 'text/html');

    const warnings: ParseWarning[] = [];

    // 容错：浏览器 parsererror（畸形 HTML）
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      warnings.push({ code: 'EP.IO.PARSE_ERROR', messageKey: 'io.warning.parseError' });
    }

    // 统计 <script> 数量（本卡给提示，脚本在编辑 iframe 因无 allow-scripts 不执行）
    const scriptCount = doc.querySelectorAll('script').length;
    if (scriptCount > 0) {
      warnings.push({
        code: 'EP.IO.SCRIPT_COUNT',
        messageKey: 'io.warning.scriptCount',
        count: scriptCount,
      });
    }

    // 外链资源清单
    const externalResources: ResourceRef[] = [];
    doc.querySelectorAll('img[src]').forEach((img) => {
      const url = img.getAttribute('src') ?? '';
      if (url) externalResources.push({ tag: 'img', url, kind: 'img' });
    });
    doc.querySelectorAll('link[href]').forEach((link) => {
      const url = link.getAttribute('href') ?? '';
      if (url) externalResources.push({ tag: 'link', url, kind: 'stylesheet' });
    });
    doc.querySelectorAll('script[src]').forEach((script) => {
      const url = script.getAttribute('src') ?? '';
      if (url) externalResources.push({ tag: 'script', url, kind: 'script' });
    });

    return { doc, warnings, externalResources };
  }

  serialize(doc: Document, opts: SerializeOptions): SerializeResult {
    if (opts.stripEditorArtifacts) {
      stripEditorArtifacts(doc);
    }
    const residue = collectResidue(doc);
    const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    return { html, residue };
  }
}
