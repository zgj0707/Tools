// 自动草稿（T117）。纯函数+localStorage，debounce。

const KEY = 'easypage:draft';

export interface DraftRecord {
  schemaVersion: 1;
  html: string;
  title: string;
  updatedAt: number;
}

export function saveDraft(html: string, title: string): 'ok' | 'too-large' | 'unavailable' {
  try {
    const rec: DraftRecord = { schemaVersion: 1, html, title, updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(rec));
    return 'ok';
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) return 'too-large';
    return 'unavailable';
  }
}

export function loadDraft(): DraftRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as DraftRecord;
    if (rec.schemaVersion !== 1) return null;
    return rec;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
