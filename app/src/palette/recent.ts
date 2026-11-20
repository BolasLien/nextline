// 指令面板「最近用過」：存項目 id（issue:NX-12、page:/issues…），新的在前，最多 8 筆。
// localStorage 在私密視窗或封鎖網站資料時會丟例外：讀不到當成空的，存不了就只在這次有效。
export const RECENT_KEY = 'nextline.palette.recent';
export const MAX_RECENT = 8;

export function readRecent(storage: Pick<Storage, 'getItem'> | undefined): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENT);
}

export function saveRecent(storage: Pick<Storage, 'setItem'> | undefined, list: readonly string[]): void {
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // 存不了就算了
  }
}

export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
