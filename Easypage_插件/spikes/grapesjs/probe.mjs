// GrapesJS 同化证伪 PoC：导入任意第三方 HTML → 观察它是否被转成组件模型、回写是否无损
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.join(__dirname, '..', '_shared', 'samples');

// 1) 搭建 jsdom 全局环境
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="gjs"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.HTMLIFrameElement = dom.window.HTMLIFrameElement;
globalThis.Node = dom.window.Node;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
// GrapesJS 会读 getComputedStyle / matchMedia 等，缺了就补桩
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){} }));

const grapesjs = (await import('grapesjs')).default ?? (await import('grapesjs'));

function norm(s){ return (s||'').replace(/\s+/g,' ').trim(); }

async function runOne(name, html) {
  console.log('\n========================================');
  console.log('SAMPLE:', name);
  const container = document.getElementById('gjs');
  container.innerHTML = '';
  let editor;
  try {
    editor = grapesjs.init({
      container: '#gjs',
      height: '300px',
      width: '100%',
      storageManager: false,
      panels: { defaults: [] },
      plugins: [],
      noticeOnUnload: false,
    });
  } catch (e) {
    console.log('INIT-FAIL:', e.message);
    return;
  }
  // 等待编辑器内部初始化
  await new Promise(r => setTimeout(r, 300));
  try {
    editor.setComponents(html);
  } catch(e){ console.log('setComponents-FAIL:', e.message); }
  await new Promise(r => setTimeout(r, 200));

  let compTypes = [];
  try {
    const root = editor.getComponents();
    root.each(m => compTypes.push(m.get('type') || m.tagName || m.get('tagName') || '?'));
    // 展开一层看模型类型分布
    const allTypes = new Set();
    root.traverse(m => allTypes.add(m.get('type') || m.tagName || 'anon'));
    console.log('ROOT-CHILD-TYPES:', JSON.stringify(compTypes));
    console.log('MODEL-TYPES-SEEN:', JSON.stringify([...allTypes]));
  } catch(e){ console.log('inspect-models-FAIL:', e.message); }

  let out = '';
  try { out = editor.getHtml(); } catch(e){ console.log('getHtml-FAIL:', e.message); }

  const inN  = norm(html);
  const outN = norm(out);
  console.log('INPUT-LEN:', inN.length, 'OUTPUT-LEN:', outN.length);

  // 证据点 1：是否注入 gjs-* 标记
  const injected = (out.match(/gjs-/g) || []).length;
  console.log('INJECTED-gjs-markers:', injected);

  // 证据点 2：原始 data-* / 自定义属性是否被保留（取样本里的 data-shadow-root 等）
  const keptShadowAttr = out.includes('data-shadow-root') ? 'KEPT' : 'DROPPED';
  const keptOnclick = /onclick=/.test(out) ? 'KEPT' : 'DROPPED';
  const keptComment = /<!--/.test(out) ? 'KEPT' : 'DROPPED';
  console.log('ATTR-data-shadow-root:', keptShadowAttr, '| inline onclick:', keptOnclick, '| HTML comment:', keptComment);

  // 证据点 3：是否引入了组件模型特有的 class（gjs-comp 等）
  console.log('HAS-gjs-comp-class:', /gjs-comp/.test(out));

  console.log('--- OUTPUT(600 chars) ---');
  console.log(outN.slice(0, 600));

  try { editor.destroy(); } catch(e){}
}

const files = ['05-ai-landing.html','10-flex-grid.html','08-inline-events.html'];
for (const f of files) {
  const html = fs.readFileSync(path.join(samplesDir, f), 'utf8');
  await runOne(f, html);
}
console.log('\nDONE');
