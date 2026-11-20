// 全域快捷鍵的判斷（docs/design/ia/README.md 第 5 段），跟 React 分開方便測。
// - Cmd/Ctrl+K：開關指令面板；焦點在輸入框也有效（開票對話框開著時不搶）。
// - 其他單鍵（C、?、G 接 B／I／M）：焦點在輸入框、或有對話框／指令面板開著時不觸發。
// - Cmd/Ctrl+Z 在 toast/ToastProvider.tsx；Esc 由各個浮層自己關（最上層的先收到）。
import { WAITING_PATH } from './NavSections';

export const G_TIMEOUT_MS = 1200;

export const GO_KEYS: Record<string, string> = {
  b: '/',
  i: '/issues',
  m: WAITING_PATH,
};

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutContext {
  typing: boolean;
  // 開票對話框或快捷鍵說明開著
  modalOpen: boolean;
  paletteOpen: boolean;
  // 上一次按 G 的時間（沒按過是 null）
  gAt: number | null;
  now: number;
}

export type Shortcut =
  | { type: 'palette' }
  | { type: 'create' }
  | { type: 'help' }
  | { type: 'go'; path: string }
  | { type: 'g' };

export function decideShortcut(e: KeyLike, ctx: ShortcutContext): Shortcut | null {
  const key = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && key === 'k' && !e.altKey && !e.shiftKey) return ctx.modalOpen ? null : { type: 'palette' };
  if (ctx.typing || ctx.modalOpen || ctx.paletteOpen || mod || e.altKey) return null;
  if (ctx.gAt !== null && ctx.now - ctx.gAt < G_TIMEOUT_MS && !e.shiftKey) {
    const path = GO_KEYS[key];
    if (path !== undefined) return { type: 'go', path };
  }
  if (e.key === '?') return { type: 'help' };
  if (e.shiftKey) return null;
  if (key === 'g') return { type: 'g' };
  if (key === 'c') return { type: 'create' };
  return null;
}
