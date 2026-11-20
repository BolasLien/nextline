import { createContext, useContext } from 'react';
import type { CreateOverride } from '../create/prefill';

// 側欄、底部分頁列、看板、快捷鍵共用的動作。
export interface ShellActions {
  // 開關 Cmd+K 指令面板（palette/CommandPalette.tsx）
  openSearch: () => void;
  // 開票對話框；依目前畫面預填（create/prefill.ts），override 例如看板欄標題的＋帶該欄狀態
  newIssue: (override?: CreateOverride) => void;
}

export const ShellActionsContext = createContext<ShellActions | null>(null);

export function useShellActions(): ShellActions {
  const ctx = useContext(ShellActionsContext);
  if (ctx === null) throw new Error('useShellActions 要在 AppShell 裡面用');
  return ctx;
}

// 焦點在輸入框時，單鍵快捷鍵（C、G、?）不觸發。
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}
