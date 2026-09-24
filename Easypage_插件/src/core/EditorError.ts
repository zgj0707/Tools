// 统一错误类型（契约 01 §9）：throw new EditorError(code, messageKey, { recoverable, hint })
// App 边界捕获后 toast，不允许未捕获异常导致白屏。
// 错误码前缀：EP.IO.*（导入导出）、EP.EDIT.*、EP.PREVIEW.*、EP.STORE.*、EP.SEC.*。

export interface EditorErrorOptions {
  recoverable: boolean;
  hint?: string;
}

export class EditorError extends Error {
  readonly code: string;
  readonly messageKey: string;
  readonly recoverable: boolean;
  readonly hint?: string;

  constructor(code: string, messageKey: string, opts: EditorErrorOptions) {
    super(`[${code}] ${messageKey}`);
    this.name = 'EditorError';
    this.code = code;
    this.messageKey = messageKey;
    this.recoverable = opts.recoverable;
    this.hint = opts.hint;
  }
}
