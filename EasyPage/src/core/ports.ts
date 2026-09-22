// ── 核心端口接口（契约 01 §4，签名逐字实现）──────────────────────────────
// 本文件只导出 interface/type/declare class 纯类型签名，无任何运行时实现、不 throw、不含业务逻辑。
// 适配器实现这些接口；core/app 只依赖这些接口。

// ── 会话与模型 ──────────────────────────────────────────────
export interface EditorSession {
  readonly doc: Document; // 被编辑页面的 Document
  readonly body: HTMLElement; // doc.body
  readonly selection: SelectionModel;
  readonly history: HistoryStack;
  readonly capabilities: CapabilityIndex;
  readonly meta: SessionMeta; // 原始导入快照、资源清单、脏标记等
  markDirty(): void;
}

// §4 EditorSession.meta —— T003 冻结形状
export interface SessionMeta {
  readonly sourceKind: 'upload' | 'paste' | 'blank'; // 导入来源
  readonly fileName: string; // 原始文件名或页面标题，用作导出默认名
  readonly originalSource: string; // 原始导入 HTML 快照（无损对比/重置基线）
  readonly warnings: ParseWarning[]; // 解析容错提示
  readonly externalResources: ResourceRef[]; // 外链资源清单
  dirty: boolean; // 是否已脏未保存
}

export interface SelectionModel {
  readonly elements: Element[]; // 当前选中（多选有序）
  select(els: Element[]): void;
  toggle(el: Element): void; // Ctrl/Shift 多选
  clear(): void;
  parentOf(el: Element): Element | null; // 面包屑选父级
  onChange(cb: () => void): () => void;
}

// 可编辑性分级（见 §7）
export type Capability =
  | 'full' // 可进入内部编辑/改样式/位移
  | 'inline-text' // 仅可整体改文本（受限）
  | 'block-only' // 仅可整体移动/隐藏/替换，不可进内部
  | 'non-editable'; // canvas/Shadow DOM 内部/伪元素等
export interface CapabilityIndex {
  of(el: Element): Capability;
  reasonOf(el: Element): string; // 不可编辑时给用户的原因文案 key
}

// ── HTML 解析 / 序列化 ──────────────────────────────────────
export interface ParseResult {
  doc: Document;
  warnings: ParseWarning[]; // 容错修复提示（数量、类型）
  externalResources: ResourceRef[]; // 外链图片/字体/脚本清单
}
export interface ParseWarning {
  code: string;
  messageKey: string;
  count?: number;
}
export interface ResourceRef {
  tag: string;
  url: string;
  kind: 'img' | 'font' | 'script' | 'stylesheet' | 'other';
}

export interface HtmlIO {
  parse(source: string): ParseResult;
  serialize(doc: Document, opts: SerializeOptions): SerializeResult;
}
export interface SerializeOptions {
  stripEditorArtifacts: boolean; // 导出必须 true
  pretty?: boolean;
}
export interface SerializeResult {
  html: string;
  residue: EditorArtifact[]; // 清理后仍检测到的编辑器残留（应为空，非空则报错阻断导出）
}
export interface EditorArtifact {
  kind: string;
  detail: string;
}

// ── 命令 / 历史 ─────────────────────────────────────────────
export interface ICommand {
  readonly name: string; // 如 'set-style'
  execute(): void;
  undo(): void;
}
export interface HistoryStack {
  push(cmd: ICommand): void; // push 时立即 execute()
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onChange(cb: () => void): () => void;
  clear(): void; // 导入/重置时
}
// 内置命令（core/commands 内实现，签名供卡片使用）
// 注：§4 以 `implements ICommand` 声明这些类；strict 下需补齐接口成员的纯声明（无实现体）。
export declare class SetTextCommand implements ICommand {
  readonly name: string;
  constructor(target: Element, next: string, prev: string);
  execute(): void;
  undo(): void;
}
export declare class SetStyleCommand implements ICommand {
  readonly name: string;
  constructor(
    targets: Element[],
    props: Record<string, string>,
    prev: Map<Element, Record<string, string>>,
  );
  execute(): void;
  undo(): void;
}
export declare class SetAttributeCommand implements ICommand {
  readonly name: string;
  constructor(target: Element, attr: string, next: string | null, prev: string | null);
  execute(): void;
  undo(): void;
}
export declare class MoveCommand implements ICommand {
  readonly name: string;
  constructor(targets: Element[], dx: number, dy: number); // 写 transform: translate
  execute(): void;
  undo(): void;
}
export declare class ResizeCommand implements ICommand {
  readonly name: string;
  constructor(
    targets: Element[],
    box: { width: number; height: number },
    prev: { width: string | null; height: string | null },
  );
  execute(): void;
  undo(): void;
}
export declare class InsertNodeCommand implements ICommand {
  readonly name: string;
  constructor(node: Node, parent: Element, index: number);
  execute(): void;
  undo(): void;
}
export declare class RemoveNodeCommand implements ICommand {
  readonly name: string;
  constructor(node: Node); // 记住 parent/index 以便 undo
  execute(): void;
  undo(): void;
}
export declare class BatchCommand implements ICommand {
  readonly name: string;
  constructor(name: string, cmds: ICommand[]);
  execute(): void;
  undo(): void;
}

// ── 画布交互（第三方交互库隔离边界；当前为自研，见 ADR-002）──
export interface DragMoveEvent {
  dx: number;
  dy: number;
  committed: boolean;
}
export interface ResizeEvent {
  width: number;
  height: number;
  committed: boolean;
}
export interface InteractionAdapter {
  attach(els: Element[]): void; // 在覆盖层为这些元素渲染选中框/手柄并接管指针
  detach(): void;
  onDragMove(cb: (e: DragMoveEvent) => void): void; // 临时移动走预览态，committed 时发 MoveCommand
  onResize(cb: (e: ResizeEvent) => void): void;
  showGuides(g: Guide[]): void; // 对齐吸附线/等距由 core 计算，适配器只负责画
  clearGuides(): void;
}
export interface Guide {
  orientation: 'h' | 'v';
  position: number;
  label?: string;
}

// ── 就地文本编辑（收敛 contentEditable）─────────────────────
export interface InlineTextEditor {
  start(el: Element): void; // 加 contenteditable/data-ep-editing，聚焦，统一 Enter
  commit(): string | null; // 取最终文本，移除标记；返回文本（null=无变化）
  cancel(): void;
  isEditing(): boolean;
}

// ── 预览沙箱（双 DOM）───────────────────────────────────────
export interface PreviewSandbox {
  open(html: string): Promise<void>; // 注入预览 iframe（脚本可运行）
  // 切回编辑前提取当前 DOM（静态 HTML）；返回 null 表示桥接超时/无法取回，调用方复用编辑 doc（不报错）
  extract(): Promise<string | null>;
  destroy(): void;
}

// ── 存储 / 本地文件 ─────────────────────────────────────────
export interface DraftRecord {
  id: string;
  title: string;
  updatedAt: number;
  sourceSnapshot: string;
  preview?: string;
}
export interface DraftStorage {
  save(d: DraftRecord): Promise<void>;
  list(): Promise<DraftRecord[]>;
  load(id: string): Promise<DraftRecord | null>;
  remove(id: string): Promise<void>;
}
export interface LocalFileGateway {
  isSupported(): boolean; // File System Access 能力检测
  open(): Promise<{ name: string; content: string } | null>;
  save(name: string, content: string): Promise<'saved' | 'download-fallback'>;
}

// ── 粘贴净化 ────────────────────────────────────────────────
export interface PasteSanitizer {
  cleanFragment(html: string): string; // 白名单标签/样式，去除 Word 专有标记与脚本
}
