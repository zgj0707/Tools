// 「该不该挂编辑器」的判定（2026-09-23 由「保存后打开文件夹」倒逼出来的一道闸；
// 那个功能当天傍晚被裁决删除，但这道闸保留 —— 用户手动在地址栏打开目录索引页
// 时同样不该被注入工具条，判据本身与那个功能无关）。
//
// 🔴 为什么这条判据值得单测：它的第二个条件（排除目录页）**看代码看不出来**，
//    只有真机会暴露 —— 暴露的方式是「工具条盖在 Chrome 渲染的文件夹列表上」。

import { describe, expect, it } from 'vitest';
import { isEditableHtml } from '../../src/extension/inject-gate';

describe('isEditableHtml · 该不该在这个文档上挂编辑器', () => {
  it('普通 html 文件 ⇒ 挂', () => {
    expect(isEditableHtml('text/html', '/C:/proj/index.html')).toBe(true);
    expect(isEditableHtml('text/html', '/C:/proj/a.b.html')).toBe(true);
    // 中文名 / 空格 / 无扩展名，都不影响判定（判据只看 contentType 与结尾斜杠）
    expect(isEditableHtml('text/html', '/C:/我的项目/报告.html')).toBe(true);
  });

  it('🔴 目录 URL ⇒ **不挂**（Chrome 的目录索引页也是 text/html，光看 contentType 拦不住）', () => {
    // 这就是「保存后打开文件夹」开出来的那个页面：contentType 是 text/html，
    // 但它是 Chrome 自己渲染的一张文件列表，不是一份可编辑的文档。
    expect(isEditableHtml('text/html', '/C:/proj/')).toBe(false);
    expect(isEditableHtml('text/html', '/C:/')).toBe(false);
    // 中文目录名同样要拦住
    expect(isEditableHtml('text/html', '/C:/我的项目/')).toBe(false);
  });

  it('非 html 文档 ⇒ 不挂（svg / xml / 纯文本，改了会把结构弄坏）', () => {
    expect(isEditableHtml('image/svg+xml', '/C:/proj/icon.svg')).toBe(false);
    expect(isEditableHtml('text/xml', '/C:/proj/data.xml')).toBe(false);
    expect(isEditableHtml('text/plain', '/C:/proj/notes.txt')).toBe(false);
    // 两条判据**各自独立**：目录页即使 contentType 是 html 也不挂，
    // 非 html 即使不是目录也不挂。缺任何一条，另一类都会漏进来。
    expect(isEditableHtml('image/svg+xml', '/C:/proj/')).toBe(false);
  });

  it('⚠️ 判据不能挂在「标题文案」上 —— 换个界面语言就会失效', () => {
    // 目录页的标题是 `C:\…\ 的索引`，这是**中文 locale 的产物**。
    // 这条用例存在的意义是把「不许改回去认标题」写进代码：
    // 判据只看 contentType 与结尾斜杠，与任何文案无关 —— 所以同一份输入必然同结论。
    const dirPath = '/C:/proj/';
    expect(isEditableHtml('text/html', dirPath)).toBe(false);
    // 反过来说：一个**恰好**叫「…的索引.html」的普通文件仍然要挂
    expect(isEditableHtml('text/html', '/C:/proj/我的索引.html')).toBe(true);
  });
});
