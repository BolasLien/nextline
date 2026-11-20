import { useCallback, useSyncExternalStore } from 'react';

// 手機版面的斷點（tokens 的 breakpoint-md 760；CSS 用 max-width: 759px）。
export const MOBILE_QUERY = '(max-width: 759px)';
// 沒有滑鼠、主要靠手指點的裝置（手機、平板）：沒有實體鍵盤，不顯示快捷鍵提示。CSS 的 .nl-kbd 用同一個條件。
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => { mql.removeEventListener('change', onChange); };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
