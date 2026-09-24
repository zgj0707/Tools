// 轻提示（P0-5 建立，P0-8 改口径）：保存是个「有结果」的动作，每一步都得给用户一句回应。
//
// 由 `toolbar.css` 的 `.ep-toast` 规则统一设置提示样式。
// Shadow DOM 里类名天然是命名空间，样式零改动继承。其中一条必须继承的是
// 「默认隐藏」：空 textContent 的 div 仍有 padding，所以首屏必须靠 `data-open='false'`
// 挡住，否则底部中央会渲染出一个空的深色药丸（旧形态 T122 走查截图为证）。
//
// ⚠️ 为什么 `position:fixed` 在本层仍然按视口解析：宿主 `#ep-root` 虽是 fixed，
// 但它没有 transform / filter / contain，不构成 fixed 后代的包含块。若将来给宿主加了
// transform（例如整体缩放），这条会静默失效 —— 提示会改挂到宿主左上角。

export type ToastTone = 'info' | 'error';

export interface Toast {
  readonly element: HTMLElement;
  show(text: string, tone?: ToastTone, ms?: number): void;
  hide(): void;
}

const DEFAULT_MS = 2600;

export function buildToast(doc: Document): Toast {
  const el = doc.createElement('div');
  el.className = 'ep-toast';
  el.setAttribute('data-ep-toast', '');
  el.setAttribute('data-open', 'false');
  // 提示不参与朗读以外的一切：它是状态播报，不是可操作控件。
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  let timer = 0;

  function hide(): void {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    el.setAttribute('data-open', 'false');
  }

  return {
    element: el,
    show(text: string, tone: ToastTone = 'info', ms: number = DEFAULT_MS): void {
      el.textContent = text;
      el.setAttribute('data-tone', tone);
      el.setAttribute('data-open', 'true');
      if (timer) clearTimeout(timer);
      // 错误留久一点：用户需要时间看清「为什么没保存成功」。
      timer = window.setTimeout(hide, tone === 'error' ? ms * 2 : ms);
    },
    hide,
  };
}

/**
 * 把保存结果翻译成一句人话。
 *
 * 单独抽出来是为了能单测 —— 用户看到的就是这句话，它比 `SaveOutcome` 本身更值得被断言。
 *
 * 主保存路线只覆盖当前 HTML 原件；结果要明确说明保存、取消或失败。
 */
export function saveMessage(
  outcome: string,
  detail?: string,
  hadScript?: boolean,
  opts?: {
    /** 有依赖未能内联时，说明副本可能仍需要源文件夹资源。 */
    notSelfContained?: boolean;
    via?: 'source-directory' | 'download';
  },
): { text: string; tone: ToastTone } {
  const scriptNote = hadScript
    ? '（页面含脚本：存下的是脚本运行后的结构；脚本运行时动态加载的资源不会自动内联）'
    : '';
  switch (outcome) {
    case 'saved': {
      const notSelf = opts?.notSelfContained
        ? '（有依赖未能内联；这份文件可能仍需要源文件夹里的资源，不适合单独分享）'
        : '';
      const result = opts?.via === 'source-directory'
        ? `已保存副本 ${detail ?? '页面'} 到源文件夹`
        : `已交给 Chrome 下载 ${detail ?? '页面'}，请在下载记录中确认完成`;
      return {
        text: `${result}${notSelf}${scriptNote}`,
        tone: 'info',
      };
    }
    case 'dirty':
      return { text: `为保护你的文件，已放弃另存：编辑器痕迹未清干净（${detail ?? ''}）`, tone: 'error' };
    default:
      return { text: `另存失败：${detail ?? '未知原因'}`, tone: 'error' };
  }
}

/** 覆盖原件保存链路的提示，不与旧的副本导出文案混用。 */
export function overwriteMessage(
  outcome: string,
  detail?: string,
  hadScript?: boolean,
  backupAvailable?: boolean,
): { text: string; tone: ToastTone } {
  const scriptNote = hadScript
    ? '（页面含脚本：动态内容若无法可靠对应回源码，保存会被阻止）'
    : '';
  switch (outcome) {
    case 'saved':
      return {
        text: `已覆盖原件 ${detail ?? '页面'}${backupAvailable ? '，原件源码已尽量按局部补丁保留并存入本机恢复点' : ''}${scriptNote}`,
        tone: 'info',
      };
    case 'cancelled':
      return { text: '已取消保存，原件未改动', tone: 'info' };
    case 'dirty':
      return { text: `为保护原件，已停止保存：${detail ?? '源码无法安全局部写回'}`, tone: 'error' };
    case 'unsupported':
      return { text: `当前环境不能直接覆盖原件：${detail ?? '浏览器未提供本地文件访问能力'}`, tone: 'error' };
    default:
      return { text: `覆盖原件失败：${detail ?? '未知原因'}`, tone: 'error' };
  }
}

/**
 * 「保存目录」动作弹原生目录框之前的面包屑提示。
 *
 * 🔴 原生目录框是 OS 级窗口，网页无法自动关、也无法预知它何时出现 —— 用户看到它
 * 会困惑「怎么突然弹框」。所以弹框前先用我们自己的 toast 说清「接下来要你选一次目录」，
 * 让用户对原生框有预期。toast 是 `role=status`，原生框停留期间它一直可见。
 */
export function inlineDepsBreadcrumb(): string {
  return '接下来请选择这份 HTML 所在的文件夹，用于保存副本和读取本地资源；选择后会记住，后续保存会优先写在这里';
}

export interface SaveTitleInfo {
  available: boolean;
  /** 副本的建议文件名，如 `index_改.html`；重名时浏览器自动加序号。 */
  target?: string;
  /** 扫描到的同目录资源 —— 保存时会尝试内联。 */
  deps?: string[];
  /** 依赖列表截断后还有多少没列出来。 */
  more?: number;
}

/**
 * 保存按钮上常驻的那句（鼠标悬停可见，不占版面）。
 *
 * 说明第一次保存会选择源文件夹；权限可用时副本写到同目录，写入失败时交给 Chrome 下载。
 */
export function saveTitle(info: SaveTitleInfo): string {
  if (!info.available) {
    // 不可用时的措辞：说清「为什么点了没用」，而不只是「不支持」。
    return '此页面不支持另存：浏览器未提供下载能力';
  }
  const name = info.target ?? '原文件名_改';
  const head = `保存为 ${name}，原文件不会被改动；首次保存会选择源文件夹，之后尝试更新同目录副本，无法写入时交给 Chrome 下载`;
  const list = info.deps ?? [];
  if (!list.length) return `${head}。当前没有扫描到同目录资源；远程链接与脚本运行时资源仍可能需要网络`;
  const names = list.join('、') + (info.more ? ` 等 ${list.length + info.more} 个` : '');
  return `${head}。检测到同目录资源（${names}）：保存时会尝试内联；远程链接与脚本运行时资源仍可能需要网络，未能内联的资源会在结果里提示`;
}

/** 当前主按钮的悬停说明：直接覆盖原件，并在每次写入前确认。 */
export function overwriteTitle(info: { available: boolean; target?: string }): string {
  if (!info.available) return '当前浏览器未提供本地文件访问能力，无法直接覆盖 HTML 原件';
  const target = info.target ?? '当前 HTML 原件';
  return `每次保存都会先确认是否覆盖 ${target}。首次选择一个已有 HTML 文件作为原件；取消确认不会写入。`;
}

/**
 * 「保存目录」按钮上常驻的说明。
 */
export function inlineDepsTitle(info: SaveTitleInfo): string {
  if (!info.available) {
    return '此页面当前无法保存';
  }
  const list = info.deps ?? [];
  const names = list.length ? `当前扫描到 ${list.length + (info.more ?? 0)} 个同目录资源` : '用于指定副本保存位置';
  return `选择或更改源 HTML 文件夹；${names}。之后保存会优先写在该文件夹，写入不可用时回退到 Chrome 下载`;
}

/**
 * 保存完成后按实际情况补充的提醒。
 */
export function saveCaveats(o: {
  /** 没内联成功的依赖 —— 非空即表示这份副本**不自包含**。 */
  failedDeps?: Array<{ path: string; reason: string }>;
  /** 没能内联、改写成绝对 file:// URL 的引用。 */
  rebased?: string[];
  /** 记住的目录中未找到当前 HTML。 */
  memoryRejected?: boolean;
  /** 源文件夹写入不可用时的回退原因。 */
  directoryIssue?: string;
}): string[] {
  const out: string[] = [];
  if (o.memoryRejected) {
    out.push(
      '之前记住的文件夹里没有这份原 HTML；可点「保存目录」重新选择源文件夹',
    );
  }
  if (o.directoryIssue) {
    out.push(`同目录保存未完成（${o.directoryIssue}），已回退到 Chrome 下载`);
  }
  const failed = o.failedDeps ?? [];
  if (failed.length) {
    const names = failed
      .slice(0, 3)
      .map((f) => `${f.path}（${f.reason}）`)
      .join('、');
    const more = failed.length > 3 ? ` 等 ${failed.length} 个` : '';
    const n = o.rebased?.length ?? 0;
    const hasRemote = failed.some((f) => f.reason.includes('远程链接'));
    const hasTemporary = failed.some((f) => f.reason.includes('blob URL'));
    const suffix = [
      hasRemote ? '另有远程链接需要网络' : '',
      hasTemporary ? '另有临时资源无法随文件保留' : '',
    ].filter(Boolean).join('；');
    const tail = n
      ? `${n} 项仍指向原目录；这份副本不自包含，拷到别的电脑可能缺少资源${suffix ? `；${suffix}` : ''}`
      : suffix || '这几项可能无法在副本中加载';
    out.push(`有 ${failed.length} 个依赖没能内联：${names}${more}。${tail}`);
  }
  return out;
}
