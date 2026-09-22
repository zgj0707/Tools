// 所有用户可见文案（契约 01 §3/§9）。代码中只引用 key，不硬编码中文字符串。

export const messages = {
  'app.title': '易页 EasyPage',

  'button.import': '导入 HTML',
  'button.blank': '新建空白',
  'button.preview': '预览',
  'button.export': '导出 HTML',
  'button.copyHtml': '复制 HTML',
  'toast.clipboardFail': '复制失败，请用下载导出',
  'toast.draftSaved': '草稿已保存',
  'toast.draftTooLarge': '内容过大，无法自动保存草稿',
  'toast.draftFail': '草稿保存失败',
  'button.chooseFile': '选择文件',
  'button.resetTransform': '重置位移',
  'button.formatPainter': '格式刷',
  'button.resume': '继续',
  'button.delete': '删除',

  // 草稿区（T117）
  'draft.none': '无草稿',
  'draft.recentPrefix': '最近草稿：',

  // ⚠️ 顶栏按钮文案是 e2e 的定位锚点（getByRole 的 name 为**子串**匹配）。
  //    新增文案前必须先确认不包含这些既有子串：
  //    导入 HTML / 导出 HTML / 复制 HTML / 新建空白 / 预览 / 重置位移 / 格式刷 /
  //    左 / 右 / 居中 / 顶 / 底 / 水平等距 / 垂直等距 / 继续 / 删除 / 确定
  'button.pasteHtml': '粘贴 HTML',
  'panel.toggleLeft': '插入与图层',
  'panel.toggleRight': '样式',
  'panel.toggleLeftHint': '展开 / 收起面板：插入、图层',
  'panel.toggleRightHint': '展开 / 收起面板：样式',

  // 导入浮层（T121 · C 版空状态引导）
  'import.title': '粘贴或选择一份 HTML',
  'import.hint': '落地页 / 活动页 / 邮件 HTML 均可；导出时自动清除编辑器痕迹。',

  // 对齐 / 分布工具条（T113）
  'align.left': '左',
  'align.right': '右',
  'align.hcenter': '居中',
  'align.top': '顶',
  'align.bottom': '底',
  'align.vcenter': '垂直居中',
  'align.hdistribute': '水平等距',
  'align.vdistribute': '垂直等距',

  // 右键菜单（T111）
  'menu.delete': '删除',
  'menu.duplicate': '复制',
  'menu.reset': '重置位移',
  'menu.lock': '锁定',
  'menu.unlock': '解锁',

  'placeholder.pasteHtml': '在此粘贴 HTML…',

  'toast.importOk': '导入成功',
  'toast.importEmpty': '请先粘贴或选择 HTML 文件',
  'toast.importFailed': '导入失败',
  'toast.previewOn': '预览已打开（脚本可运行）',
  'toast.previewOff': '已返回编辑',
  'toast.exportOk': '导出成功',
  'toast.exportOkWithExternal': '导出成功（含外链资源，离线打开可能失效）',
  'toast.residue': '导出失败：检测到编辑器残留',
  'toast.exportFailed': '导出失败',
  'toast.noDocument': '请先导入 HTML',
  'toast.undo': '已撤销',
  'toast.redo': '已重做',
  'toast.locked': '该元素已锁定',
  'toast.alignNeed2': '对齐需要至少 2 个元素',
  'toast.alignNeed3': '等距分布需要至少 3 个元素',
  'toast.alignCrossParent': '仅支持同父元素对齐/分布',
  'toast.richLater': '选区格式将在后续版本支持',
  'toast.unsupported': '该选区暂不支持格式化',
  'toast.nonEditable': '该元素不可编辑',
  'toast.blockOnly': '该元素仅可整体移动/隐藏',
  'toast.listMulti': '暂不支持多选转换列表',
  'toast.listUnsupported': '暂不支持此块转换为列表',

  'panel.style.title': '样式',
  'panel.style.mixed': '混合',
  'panel.style.fontFamily': '字体',
  'panel.style.fontSize': '字号',
  'panel.style.fontWeight': '字重',
  'panel.style.color': '文字颜色',
  'panel.style.bgColor': '背景色',
  'panel.style.align': '对齐',
  'panel.style.lineHeight': '行高',
  'panel.style.letterSpacing': '字距',
  'panel.style.list': '列表',
  'panel.style.toList': '转为列表',
  'panel.style.unlist': '取消列表',
  'panel.style.link': '链接',
  'panel.style.setLink': '设置链接',
  'panel.style.clearLink': '清除链接',

  // 未选中态（T122）：面板不得沿用上一个选中元素的值冒充当前状态
  'panel.style.unset': '—',
  'panel.style.empty': '未选中元素 · 点击画布中的元素开始编辑',

  // 盒模型区（T122）：原先直接渲染英文 CSS 属性名，与上方中文标签混排。
  // 英文属性名改挂 label 的 title，hover 仍可查到精确属性。
  'panel.style.box': '盒模型',
  'panel.style.box.width': '宽度',
  'panel.style.box.height': '高度',
  'panel.style.box.marginTop': '上外边距',
  'panel.style.box.marginRight': '右外边距',
  'panel.style.box.marginBottom': '下外边距',
  'panel.style.box.marginLeft': '左外边距',
  'panel.style.box.paddingTop': '上内边距',
  'panel.style.box.paddingRight': '右内边距',
  'panel.style.box.paddingBottom': '下内边距',
  'panel.style.box.paddingLeft': '左内边距',

  // 外观区（T122）：同上。border-style 的 value 仍是 CSS 关键字，只本地化显示文案。
  'panel.style.deco': '外观',
  'panel.style.deco.borderWidth': '边框粗细',
  'panel.style.deco.borderStyle': '边框样式',
  'panel.style.deco.borderColor': '边框颜色',
  'panel.style.deco.radius': '圆角',
  'panel.style.deco.opacity': '不透明度',
  'panel.style.deco.shadow': '阴影',
  'panel.style.deco.shadowX': '阴影 X',
  'panel.style.deco.shadowY': '阴影 Y',
  'panel.style.deco.shadowBlur': '阴影模糊',
  'panel.style.deco.shadowSpread': '阴影扩散',
  'panel.style.deco.shadowColor': '阴影颜色',
  'panel.style.borderStyle.none': '无',
  'panel.style.borderStyle.solid': '实线',
  'panel.style.borderStyle.dashed': '虚线',
  'panel.style.borderStyle.dotted': '点线',

  // 左侧插入面板（T122）：原为硬编码中文，违反契约 01 §3/§9。
  // ⚠️ 这四个字串是 list.spec.ts 的 getByRole 定位锚点，改文案必须同步改用例。
  'panel.elements.title': '插入',
  'panel.elements.delete': '删除选中',
  'panel.elements.ul': '项目符号列表',
  'panel.elements.ol': '编号列表',
} as const;

export type MessageKey = keyof typeof messages;

export function t(key: MessageKey): string {
  return messages[key];
}
