// 净化 PoC：DOMPurify vs 自研白名单，对同一组攻击/脏 HTML 跑动作电池
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

const dom = new JSDOM('');
const purify = DOMPurify(dom.window);

const ALLOWED_TAGS = new Set(['a','b','i','u','strong','em','br','p','span','div','ul','ol','li','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','td','th','img','figure','figcaption','blockquote','code','pre']);
const DANGEROUS_ATTR = /^on/i;
function selfBuiltWhitelist(html) {
  const doc = new (dom.window.DOMParser)().parseFromString(`<div>${html}</div>`, 'text/html');
  function walk(node){
    [...node.children].forEach(el => {
      if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) { el.remove(); return; }
      [...el.attributes].forEach(a => {
        if (DANGEROUS_ATTR.test(a.name)) el.removeAttribute(a.name);
        else if ((a.name==='href'||a.name==='src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
      walk(el);
    });
  }
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

const cases = [
  ['script',         '<p>hi</p><script>alert(1)<\/script>'],
  ['inline-onerror', '<img src="x" onerror="alert(1)">'],
  ['inline-onclick', '<a href="#" onclick="track()">link</a>'],
  ['javascript-url',  '<a href="javascript:alert(1)">x</a>'],
  ['iframe',         '<p>x</p><iframe src="https://evil"></iframe>'],
  ['Word-mso',       '<p class="MsoNormal" style="margin:0cm"><b>one</b></p>'],
  ['svg-xss',        '<svg><script>alert(1)</script></svg>'],
  ['normal-keep',    '<p>para <strong>b</strong> <a href="https://ok.com">a</a></p>'],
];

console.log('CASE                | DOMPurify out                               | selfBuilt out');
console.log('--------------------+---------------------------------------------+---------------------------------------------');
for (const [name, html] of cases) {
  const d = purify.sanitize(html);
  const s = selfBuiltWhitelist(html);
  const clip = (x,n)=> (x||'').replace(/\s+/g,' ').trim().slice(0,n);
  console.log((name.padEnd(19,' '))+'| '+clip(d,43).padEnd(44,' ')+'| '+clip(s,43));
}

const r1 = purify.sanitize('<img src=x onerror=alert(1)>');
const r2 = purify.sanitize('<script>alert(1)<\/script>');
console.log('\nDOMPurify residual onerror:', /onerror/i.test(r1) ? 'FAIL' : 'OK');
console.log('DOMPurify residual script :', /<script/i.test(r2) ? 'FAIL' : 'OK');
console.log('DOMPurify version:', purify.version);
process.exit(0);
