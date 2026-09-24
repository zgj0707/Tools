---
name: easypage-html-embed
description: Use when the user asks to add or update the EasyPage self-editor snippet in a local HTML file, fetching the generated code block from the Tools GitHub repository while preserving the page source.
---

# 将易页自编辑器嵌入 HTML

当用户要求把易页 EasyPage 自编辑器放进某个 HTML、更新页面里已有的编辑器代码块，或为新 HTML 加入自编辑能力时使用。

## 操作流程

1. **确认目标文件。** 根据用户给出的绝对路径或当前工作区内明确的文件名定位一个 `.html` / `.htm` 文件。存在多个候选时先询问。只处理用户指定的本地文件；网页 URL 不是可直接覆盖的本地文件。
2. **获取仓库生成的代码块。** 来源为 `zgj0707/Tools` 的 `main` 分支，文件路径 `Easypage_插件/dist-embed/easypage-self-editor-snippet.html`。优先用 GitHub 仓库文件读取工具；大文件不要全部输出到对话，可通过 HTTPS 下载到临时文件。若可行，先解析 `main` 对应的 commit SHA，再按该 SHA 下载，避免读取期间分支更新。只有用户指定版本时才改用其他 ref。
3. **确认代码块完整。** 文件应以 `<script data-easypage-self-editor="1">` 开始，并以 `</script>` 结束。下载失败、内容被截断或标记不匹配时停止，不要使用源码模块、旧对话内容或手工重建的代码替代。若无法解析 commit SHA，可以读取 main，但必须在结果中说明版本没有固定到 commit。
4. **检查目标 HTML。** 读取其编码、BOM、换行风格、`</body>` / `</html>` 位置、CSP，以及现有 `data-easypage-self-editor="1"` 脚本标签。若编码不是可无损处理的 UTF-8 或带 BOM 的 UTF-16，使用字节级补丁；当前工具无法保真处理时停止，不要转码整页。
5. **为目标文件留恢复副本。** 真正写入前，在同目录创建不覆盖已有文件的唯一备份。若用户明确要求不备份，遵从该要求。
6. **做幂等的最小修改。**
   - 没有编辑器标记时，只插入一个完整代码块：优先放在 `</body>` 前，其次放在 `</html>` 前；两者都不存在时追加到文件末尾。
   - 恰有一个编辑器脚本时，将它整体替换为仓库取得的新脚本。代码块边界只包含该 `<script ...>` 与对应 `</script>`，保留页面其余源码。
   - 找到多个编辑器脚本、标记残缺或边界不明确时停止并报告位置，不自动清理或合并。
   - 保留目标文件原有编码、BOM、换行与周边缩进。不得通过 DOM 解析后序列化整页，不格式化页面，不改其他资源引用、CSP 或业务脚本。
7. **回读核对。** 检查目标文件中恰有一个编辑器脚本，插入或替换的代码与下载文件一致，原代码块之外的内容没有变化。汇报目标路径、插入还是更新、备份路径、仓库 ref/commit SHA 和任何限制。
8. **说明人工验证步骤。** 让用户在 Chrome 打开修改后的本地 HTML，检查工具条、编辑、保存与恢复。不要把静态源码核对描述成浏览器功能验证。

## 运行限制

- 代码块通过内联 `<script>` 运行；页面 CSP 若禁止内联脚本，工具条不会执行。不要擅自修改 CSP，说明原因并等待用户选择。
- 覆盖保存针对 Chrome 中打开的本地 `file://` HTML，并且每次写入前会询问确认。网站上的 HTML 不能由页面脚本直接覆盖服务器文件。
- 只从 GitHub 读取这段编辑器代码；不要把目标 HTML 上传、发送或粘贴到外部服务。
- 最新生成物约 200 KB。报告实际读取的 commit SHA；若只能读取可变的 `main`，如实说明。

仓库地址：[zgj0707/Tools](https://github.com/zgj0707/Tools)，代码块：[easypage-self-editor-snippet.html](https://github.com/zgj0707/Tools/blob/main/Easypage_%E6%8F%92%E4%BB%B6/dist-embed/easypage-self-editor-snippet.html)。
