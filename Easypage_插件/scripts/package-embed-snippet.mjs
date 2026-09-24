import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'dist-embed', 'easypage-self-editor.js');
const snippetPath = path.join(root, 'dist-embed', 'easypage-self-editor-snippet.html');

const bundle = await readFile(bundlePath, 'utf8');
if (!bundle.trim()) throw new Error(`编辑器构建产物为空：${bundlePath}`);

// HTML 的 <script> 是 raw-text 元素；即使序列出现在 JS 字符串或注释里，
// 未转义的 </script 也会先被 HTML 解析器当作结束标签。
const safeBundle = bundle.replace(/<\/script/gi, '<\\/script');
// The IIFE build declares its library name at top level. Add one local scope so the
// generated script does not publish EasyPageSelfEditor on the host page's window.
const snippet = `<script data-easypage-self-editor="1">\n(()=>{\n${safeBundle}\n})();\n</script>\n`;

if (/<\/script\b/i.test(safeBundle)) {
  throw new Error('生成片段仍包含可能提前结束 script 的标签序列');
}

await writeFile(snippetPath, snippet, 'utf8');
process.stdout.write(`已生成可粘贴片段：${path.relative(root, snippetPath)}\n`);
