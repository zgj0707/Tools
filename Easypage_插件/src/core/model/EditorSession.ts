// 会话模型（契约 01 §4 EditorSession）。
//   - history：T102 起用真实 HistoryStackImpl。
//   - capabilities：T108 最小 CapabilityScanner（默认 full，不可见节点 non-editable，canvas/svg 内部 block-only）。

import type {
  Capability,
  CapabilityIndex,
  EditorSession,
  HistoryStack,
  SessionMeta,
} from '../ports';
import { SelectionModel } from './SelectionModel';
import { HistoryStackImpl } from '../commands/HistoryStack';

const NON_EDITABLE = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'br', 'hr']);
const BLOCK_ONLY = new Set(['canvas', 'svg', 'iframe', 'video', 'audio']);

class CapabilityScanner implements CapabilityIndex {
  of(el: Element): Capability {
    const tag = el.tagName.toLowerCase();
    if (NON_EDITABLE.has(tag)) return 'non-editable';
    if (BLOCK_ONLY.has(tag)) return 'block-only';
    return 'full';
  }
  reasonOf(el: Element): string {
    const c = this.of(el);
    if (c === 'non-editable') return 'toast.nonEditable';
    if (c === 'block-only') return 'toast.blockOnly';
    return '';
  }
}

export class EditorSessionModel implements EditorSession {
  readonly doc: Document;
  readonly body: HTMLElement;
  readonly selection: SelectionModel;
  readonly history: HistoryStack;
  readonly capabilities: CapabilityIndex;
  readonly meta: SessionMeta;

  constructor(doc: Document, meta: SessionMeta) {
    const body = doc.body;
    if (!body) {
      throw new Error('被编辑文档缺少 <body>');
    }
    this.doc = doc;
    this.body = body;
    this.selection = new SelectionModel();
    this.history = new HistoryStackImpl();
    this.capabilities = new CapabilityScanner();
    this.meta = meta;
  }

  markDirty(): void {
    this.meta.dirty = true;
  }
}
