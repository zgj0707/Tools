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
} as const;

export type MessageKey = keyof typeof messages;

export function t(key: MessageKey): string {
  return messages[key];
}
