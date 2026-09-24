# EasyPage HTML 自编辑器嵌入 Skill

这个 Skill 把易页自编辑器的最新自包含代码块嵌入用户指定的 HTML 文件，也可以将页面中已有的编辑器代码块更新到指定仓库版本。

## 文件结构

- `SKILL.md`：Codex 自动识别的技能说明与执行边界。
- `agents/openai.yaml`：技能列表中的名称、简介和默认提示词。
- `README.md`：安装、调用、来源和限制说明。

本 Skill 不内置 200 KB 左右的编辑器副本。每次操作都会从仓库取代码，避免仓库更新后 Skill 继续使用旧版本。

## 代码来源

- 仓库：`zgj0707/Tools`
- 默认版本：`main` 分支；用户指定 commit、tag 或分支时使用指定 ref。
- 文件：`Easypage_插件/dist-embed/easypage-self-editor-snippet.html`
- GitHub 页面：[打开代码块](https://github.com/zgj0707/Tools/blob/main/Easypage_%E6%8F%92%E4%BB%B6/dist-embed/easypage-self-editor-snippet.html)
- 原始文件：[下载代码块](https://raw.githubusercontent.com/zgj0707/Tools/main/Easypage_%E6%8F%92%E4%BB%B6/dist-embed/easypage-self-editor-snippet.html)

优先使用可用的 GitHub 仓库读取工具。下载到临时文件可避免把完整代码块载入对话上下文；若能先解析 commit SHA，再按 SHA 下载并记录该 SHA。

## 安装

### 在 Tools 仓库中使用

将仓库克隆到本地，并以仓库根目录打开 Codex。技能位于 `.agents/skills/easypage-html-embed`，会作为项目 Skill 自动发现。

### 安装为个人 Skill

将整个 `easypage-html-embed` 文件夹复制到 `$CODEX_HOME/skills/`。若没有设置 `CODEX_HOME`，Windows 默认路径为 `%USERPROFILE%\.codex\skills\easypage-html-embed`。安装后重载技能列表或重新打开任务。

## 调用示例

在提示中明确给出目标 HTML 路径，例如：

> 使用 $easypage-html-embed，把最新易页自编辑器加入 `D:\pages\portfolio.html`。

更新页面中已有版本时，可以指定仓库 ref：

> 使用 $easypage-html-embed，把 `D:\pages\portfolio.html` 里的编辑器更新到 Tools 仓库 commit `abcdef...`。

如果工作区中同名 HTML 不止一个，Skill 会先让用户指定确切文件。没有目标 HTML 时，Skill 只说明如何调用，不会自行挑选页面。

## 编辑策略

1. 下载并检查生成的 HTML `<script>` 代码块完整性。
2. 检查目标文件编码，并在写入前创建一个不覆盖已有文件的同目录备份。
3. 如果没有编辑器标记，在 `</body>` 前插入；没有 `</body>` 时使用 `</html>`，再没有则追加到文件末尾。
4. 如果已有一个编辑器标记，只替换该脚本代码块。多个标记或代码边界不清楚时停止，让用户决定如何处理。
5. 保留代码块之外的 HTML 源码、缩进、换行、编码和 BOM。禁止整页 DOM 序列化或格式化。
6. 回读文件，核对标记只有一处、嵌入内容与下载版本一致，并报告仓库 ref / SHA、目标路径和备份位置。

## 使用限制

- 该编辑器的覆盖保存要求在 Chrome 中直接打开本地 `file://` HTML。若目标是服务器上的网页文件，需要用户另行部署修改后的 HTML。
- 页面 CSP 禁止内联脚本时，嵌入代码无法执行；Skill 不会自动放宽 CSP。
- 页面内容只在本地读取和修改。网络请求只用于下载易页编辑器代码块，不上传目标 HTML。
- 仓库读取、源码差异核对不等同于真实浏览器验证。完成后由用户在 Chrome 中人工验证工具条、编辑、保存和恢复流程。
