// 深淺色：跟系統（不設 data-theme，tokens.css 依 prefers-color-scheme）、淺色、深色。
// 選擇記在 localStorage；public/theme-init.js 在畫面出來前用同一個 key 先套上。
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'nextline.theme';

export const THEME_OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: '跟系統' },
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
];

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

// localStorage 在私密視窗或封鎖網站資料時可能丟例外；讀不到就當成跟系統。
export function readTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemeChoice {
  try {
    return parseTheme(storage?.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function saveTheme(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, choice: ThemeChoice): void {
  try {
    if (choice === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    // 存不了就只套用在這次瀏覽。
  }
}

export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}
