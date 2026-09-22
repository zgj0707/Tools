// 导出资源审计（T116）。纯函数，列外链与未内嵌资源。

export interface ResourceWarning {
  kind: 'external' | 'blob' | 'data';
  url: string;
  detail: string;
}

export function auditResources(doc: Document): ResourceWarning[] {
  const out: ResourceWarning[] = [];
  doc.querySelectorAll('img, script, link, source, video, audio').forEach((el) => {
    const any = el as unknown as Record<string, string>;
    const url = any.src || any.href || '';
    if (!url) return;
    if (url.startsWith('blob:')) {
      out.push({ kind: 'blob', url, detail: '本地 objectURL 图片未内嵌，换电脑/分享会失效（base64 内嵌为 P1）' });
    } else if (url.startsWith('data:')) {
      out.push({ kind: 'data', url: url.slice(0, 60) + '…', detail: 'data: 已内嵌' });
    } else if (/^https?:\/\//.test(url)) {
      out.push({ kind: 'external', url, detail: '外链资源，导出后仍需联网加载' });
    }
  });
  return out;
}
