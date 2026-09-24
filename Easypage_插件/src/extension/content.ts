// 本文件只做装配：判断「该不该挂」→ 挂宿主 → 挂覆盖层、提示与工具条
// → 接通模式、格式、历史与保存。逻辑一律不写在本文件里。
// 已完成：覆盖层、事件仲裁、文字格式、历史与原 HTML 覆盖保存。
// 每次实际写入前要求确认；首次通过 Chrome 文件选择器指定现有原件，之后复用文件句柄。

import { mountHost, type EpHost } from './host';
import { buildBar, type Bar } from './ui/bar';
import { buildOverlay } from './ui/overlay';
import { buildToast, overwriteMessage } from './ui/toast';
import { createEditor } from './interaction';
import { createInlineEditor } from './inline';
import { canApplyTextFormat, isFormatOn, setTextColor, toggleFormat } from './format';
import {
  browserOpenFilePicker,
  rememberedFileForSave,
  saveOriginalDocument,
  restoreOriginalBackup,
  suggestedNameFrom,
  type SaveResult,
} from './save';
import { isEditableHtml } from './inject-gate';
import { createHandleStore, createIdbBackend, pathKeyOf } from './handle-store';
import { captureSourceBaseline } from './preserve-source';
import { HistoryStackImpl } from '../core/commands/HistoryStack';
import { SetHtmlCommand } from '../core/commands/commands';
import { EPX, type ExtensionMode } from './anchors';

/** 重复注入护栏。content script 有自己的 isolated world，该标记不会与页面变量冲突。 */
const INJECTED_FLAG = '__easyPageInjected';

function isEditableHtmlDocument(): boolean {
  // 判据本身与它的来由（尤其是「为什么必须排除目录页」）写在 `inject-gate.ts`。
  return isEditableHtml(document.contentType, location.pathname);
}

function bootstrap(): void {
  const world = window as unknown as Record<string, unknown>;
  if (world[INJECTED_FLAG] === true) return;
  world[INJECTED_FLAG] = true;

  // 扩展 content script 与内嵌片段运行在不同 JS world，但能看到同一个 DOM。
  // 若二者都启用，只允许先挂载的一方工作，避免出现两套编辑工具。
  if (document.querySelector(`[${EPX.HOST_MARKER_ATTR}="1"]`)) return;

  if (!isEditableHtmlDocument()) return;

  // Kept before host mounting and before user edits; each successful save advances this baseline.
  let sourceBaseline = captureSourceBaseline(document);

  let host: EpHost;
  try {
    host = mountHost(document);
  } catch (err) {
    // 页面可能处于极度异常的状态（例如 documentElement 已不存在）。
    // 插件绝不能因此把页面弄崩 —— 挂不上就安静退出，页面保持原样。
    console.warn('[easy-page] 挂载失败，已放弃注入：', err);
    return;
  }

  // 命令栈直接复用旧形态的实现（core 层纯逻辑，与宿主形态无关）。
  // ⚠️ 已知边界：命令持有 Element 引用 —— 页面重渲染把元素换掉之后，
  // 撤销会作用在已脱离文档的旧节点上。这是 07 · C1 登记的风险，P0 不做处理。
  const history = new HistoryStackImpl();

  // 覆盖层先建：就地改字要把「正在改谁」广播给它画虚线框，所以它得先存在。
  const overlay = buildOverlay(document, host.element);
  host.ui.appendChild(overlay.element);

  // 轻提示：另存的结果靠它说一句人话（成功 / 取消 / 不支持 / 已放弃写入）。
  const toast = buildToast(document);

  // 就地改字：提交时写回 innerHTML（见 inline.ts 文件头，textContent 会丢行内标签）。
  // ⚠️ 必须配 SetHtmlCommand —— 用 SetTextCommand 会把整段 HTML 当纯文本写进去，
  // 页面上直接显示 `<strong>…</strong>` 源码，且原有行内元素被抹掉（探针第 3 项守这条）。
  const inline = createInlineEditor(
    (el, next, prev) => {
      history.push(new SetHtmlCommand(el, next, prev));
    },
    // 改字态的可见反馈（P0-4 补）：虚线框的出现与消失**只由就地编辑器驱动**，
    // 不让调用方在各处自己清 —— commit / cancel / 退出编辑模式 / 传位给下一个元素，
    // 四条出口都在 `finish()` 里汇成一次通知，不可能漏。
    (el) => overlay.setEditing(el),
  );

  let mode: ExtensionMode = 'browse';

  /** 把当前状态同步到工具条：格式按钮的可用性/激活态、历史按钮的可用性。 */
  function syncBar(): void {
    const el = overlay.getSelected();
    const formatable = mode === 'edit' && canApplyTextFormat(el);
    bar.syncFormat({
      enabled: formatable,
      bold: formatable && isFormatOn(el, 'bold'),
      italic: formatable && isFormatOn(el, 'italic'),
      underline: formatable && isFormatOn(el, 'underline'),
      color: formatable ? (el as HTMLElement).style.color || null : null,
    });
    bar.syncHistory({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  }

  const editor = createEditor(host, overlay, {
    onPick: () => syncBar(),
    onActivate: (el) => {
      // 双击：进入就地改字。不可改字的元素（容器类）会在这层被 start() 挡掉。
      inline.start(el);
      syncBar();
    },
    onBeforePick: () => {
      // 本层 preventDefault 过 mousedown ⇒ contenteditable 拿不到 blur，
      // 必须在这里主动收尾，否则编辑态会赖着不走。
      if (inline.isEditing()) inline.commit();
    },
    // 就地改字中必须把指针事件放行给 contenteditable —— 否则用户无法用鼠标
    // 拖选文字，而选区正是「只加粗这一个词」的前提。
    getEditingEl: () => inline.getEditingEl(),
    onUndo: () => history.undo(),
    onRedo: () => history.redo(),
    onToggleFormat: (format) => {
      toggleFormat(format, overlay.getSelected(), history);
      syncBar();
    },
  });

  function apply(next: ExtensionMode): void {
    mode = next;
    host.element.setAttribute(EPX.MODE_ATTR, next);
    bar.setMode(next);
    // 只有编辑模式才装事件仲裁并显示覆盖层；浏览模式下**一个监听器都不留**，
    // 页面行为必须与「没装插件」逐字一致 —— 这是插件最不能让步的一条。
    if (next === 'edit') {
      editor.enable();
    } else {
      // 退出编辑模式前先收尾就地编辑，否则 contenteditable 与 data-ep-editing
      // 会留在用户页面的元素上（那是「必须可完全清除」契约的一部分）。
      if (inline.isEditing()) inline.commit();
      editor.disable();
    }
    bar.closeColorPopover();
    syncBar();
  }

  const bar: Bar = buildBar(document, {
    onToggleEditMode: () => apply(mode === 'edit' ? 'browse' : 'edit'),
    onHide: () => {
      bar.element.setAttribute('data-hidden', 'true');
    },
    onToggleFormat: (format) => {
      toggleFormat(format, overlay.getSelected(), history);
      syncBar();
    },
    onPickColor: (color) => {
      setTextColor(overlay.getSelected(), color, history);
      syncBar();
    },
  onUndo: () => history.undo(),
  onRedo: () => history.redo(),
    onSave: () => {
      void save();
    },
    onRestore: () => {
      void restoreBackup();
    },
  });

  host.ui.appendChild(bar.element);
  host.ui.appendChild(toast.element);

  // 直接覆盖依赖 File System Access API；没有下载回退，因为下载不会覆盖当前原件。
  const isLocalFile = location.protocol === 'file:';
  const filePicker = isLocalFile ? browserOpenFilePicker() : null;
  const saveUnavailableReason = isLocalFile
    ? undefined
    : '请在 Chrome 中直接打开本地 HTML 文件后覆盖保存';
  let saveAvailable = isLocalFile && filePicker !== null;
  const store = createHandleStore(createIdbBackend());
  // 先恢复当前 URL 对应的原件句柄；恢复完成前暂禁保存，避免误触发原生选择器。
  let rememberedFile: Awaited<ReturnType<typeof rememberedFileForSave>> = null;
  let fileReady = false;
  const rememberedFilePromise = rememberedFileForSave(store, location.href);
  const savedBackupPromise = store.loadBackup?.(pathKeyOf(location.href)) ?? Promise.resolve(null);
  let saving = false;

  async function save(): Promise<void> {
    if (saving || !fileReady) return;
    saving = true;
    bar.setSaveState({ available: saveAvailable, busy: true });

    // 🔴 先把正在改的那一段落地：就地改字的内容只存在于 DOM 里，
    // 若用户敲完字没按 Enter 就直接点保存，不提交就会丢掉最后一次输入。
    if (inline.isEditing()) inline.commit();

    // 克隆、权限确认或文件写入任一步抛异常时恢复按钮状态并提示，避免无反馈。
    let result: SaveResult;
    try {
      result = await saveOriginalDocument(document, location.href, {
        picker: filePicker,
        handle: rememberedFile,
        store,
        confirm: (message) => window.confirm(message),
        sourceBaseline,
        onSaved: (nextBaseline) => {
          sourceBaseline = nextBaseline;
        },
      });
    } catch (err) {
      saving = false;
      bar.setSaveState({ available: saveAvailable });
      toast.show(`覆盖原件失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      return;
    }

    saving = false;
    if (result.handle) rememberedFile = result.handle;
    if (result.forgetHandle) {
      rememberedFile = null;
      bar.setBackupAvailable(false);
    }
    bar.setSaveState({ available: saveAvailable });
    if (result.backupAvailable) bar.setBackupAvailable(true);

    const msg = overwriteMessage(result.outcome, result.detail, result.hadScript, result.backupAvailable);
    toast.show(msg.text, msg.tone);
  }

  async function restoreBackup(): Promise<void> {
    if (saving || !fileReady) return;
    if (!rememberedFile) {
      toast.show('恢复备份前，请先保存一次以重新选择原件', 'error');
      return;
    }
    saving = true;
    bar.setSaveState({ available: saveAvailable, busy: true });
    let result: SaveResult;
    try {
      result = await restoreOriginalBackup(location.href, rememberedFile, store);
    } catch (err) {
      result = { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) };
    }
    saving = false;
    bar.setSaveState({ available: saveAvailable });
    if (result.outcome === 'saved') {
      toast.show('已恢复最近一次保存前的原文件，正在重新载入…', 'info');
      window.setTimeout(() => location.reload(), 250);
      return;
    }
    toast.show(result.outcome === 'cancelled' ? '已取消恢复，文件未改动' : `恢复失败：${result.detail ?? '未知原因'}`, result.outcome === 'cancelled' ? 'info' : 'error');
  }

  // 历史一变就刷新按钮可用性（push / undo / redo 都会触发）。
  history.onChange(syncBar);

  // 原件句柄恢复完成前暂禁保存，恢复后再开放按钮。
  bar.setSaveState({
    available: saveAvailable,
    busy: true,
    reason: saveUnavailableReason ?? '正在恢复原件访问…',
    target: suggestedNameFrom(location.href),
  });

  void Promise.all([rememberedFilePromise.catch(() => null), savedBackupPromise.catch(() => null)])
    .then(([file, backup]) => {
      rememberedFile = file;
      saveAvailable = isLocalFile && (filePicker !== null || file !== null);
      fileReady = true;
      bar.setBackupAvailable(file !== null && backup !== null);
      bar.setSaveState({ available: saveAvailable, reason: saveUnavailableReason });
    });

  apply('browse');
}

bootstrap();
