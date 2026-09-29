---
name: html-self-editor-install
description: 把「HTML 自编辑插件」安装进任意本地 HTML 文件，使其获得浮动工具栏 + 就地编辑 + Ctrl+S 保存到原文件的能力。当用户说「给这个 HTML 装自编辑插件」「给 HTML 加编辑工具栏」「安装 HTML 自编辑代码块」「把这个插件装到 HTML 里」时使用。插件代码块来自 assets/self-editor-plugin.html，安装位置为 </body> 前，同名插件覆盖更新，装完做结构校验。
---

# HTML 自编辑插件安装

## 用途
给一个本地 HTML 文件注入一段自编辑插件脚本，让该文件在 Chrome 中打开后：
- 右上角浮动工具栏（抓柄 / 编辑模式 / B / I / U / 保存）
- **工具栏可拖动**：按住左侧抓柄「≡」（或工具条空白处）拖动换位，避免遮挡内容；位置按页面存进 `localStorage`（键 `epx-bar-pos:<url>`），下次打开自动恢复。按钮本身只响应点击，不会误触拖动
- 进入编辑模式后 `document.body.contentEditable = true` 就地编辑
- Ctrl+S 或点「保存」→ 用 File System Access API 写回**原文件**（首次弹保存框，之后用 IndexedDB 记住文件句柄，免二次确认）

## 插件模板
- 模板文件：`assets/self-editor-plugin.html`
- 内容：一段 `<script data-easypage-self-editor="1">...</script>`（IIFE，自包含，无外链）
- 来源：EasyPage 项目 `dist-embed/easypage-self-editor-simple.html` 的「简单版」产物，**不要改动其内部逻辑**，除非用户明确要求升级功能
- 版本演进：v1 = 基础工具栏 + 保存；v2 = 增加工具条拖动（抓柄 + `localStorage` 记忆位置）

## 安装步骤
1. 读取目标 HTML 全文（若文件很大，先定位 `</body>` 位置）。
2. 读取模板 `assets/self-editor-plugin.html` 全文。
3. 在目标 HTML 的 `</body>` 标签**之前**插入模板内容（保持与源文件一致的换行风格）。
4. 若目标 HTML 已存在 `<script data-easypage-self-editor="1">` 块 → **删除旧块，替换为新模板**（覆盖更新，避免重复注入两个 host）。

## 安装后校验（必须执行）
装完用 Grep 在目标文件确认：
- [ ] 恰好 1 处 `data-easypage-self-editor="1"`
- [ ] 存在 `epx-simple-host`（host 容器 id）
- [ ] 存在 `showSaveFilePicker` 调用（保存能力）
- [ ] 存在拖动能力：`bar .grip` + `epx-bar-pos`（v2 特征）
- [ ] 脚本位于 `</body>` 之前（而非 `<head>` 或 body 之后）

## 版本升级（v1 → v2）
- **判据**：目标文件已有 `data-easypage-self-editor="1"` 但**没有** `bar .grip` / `epx-bar-pos` ⇒ 是 v1 旧版，需替换。
- **动作**：删除旧 `<script data-easypage-self-editor="1">...</script>` 整块（从起始标签到其对应 `</script>`），再插入新模板；不要只做追加，否则会注入两个 host。

## 边界与注意
- 仅适用于**本地 HTML 文件**（`file://` 打开）。插件保存逻辑已内置 `location.protocol !== "file:"` 拦截，非 file 协议会 toast 提示。
- 插件依赖浏览器能力：`showSaveFilePicker`（File System Access API，Chrome/Edge 支持）、`indexedDB`、`localStorage`。不支持时插件会 toast 报错或静默跳过拖动记忆，属预期降级，不是安装失败。
- **工具栏位置存在 `localStorage`**（键 `epx-bar-pos:<url>`），不写进 HTML 文件；清除浏览器站点数据会丢失位置（回落默认右上角），不影响文件内容。
- 安装是**就地修改目标文件**。若用户要求「另存为新文件」或「不污染原文件」，先复制一份再装，或改用下载式保存方案（见项目 EasyPage 的保存定案）。
- 不要给模板脚本内部加溯源属性/注释（保持与源一致，便于后续 diff 升级）。

## 验证方式
- 静态：按「安装后校验」清单 Grep 目标文件。
- 动态（可选）：用 Playwright headed 打开 `file://` 目标文件，断言工具栏 `bar` 出现、抓柄 `.grip` 存在、点「编辑模式」后 `body[contenteditable="true"]`；拖动后读 `localStorage` 的 `epx-bar-pos:*` 确认位置已存。