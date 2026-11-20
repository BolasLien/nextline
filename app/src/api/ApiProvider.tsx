import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type ApiClient, ApiError, createApiClient, MESSAGES } from './client';

interface ApiContextValue {
  api: ApiClient;
  // 任何一個請求拿到 401 就變 true，畫面頂端顯示「重新登入」。
  sessionExpired: boolean;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const api = useMemo(() => client ?? createApiClient({ onUnauthorized: () => { setSessionExpired(true); } }), [client]);
  const value = useMemo(() => ({ api, sessionExpired }), [api, sessionExpired]);
  return <ApiContext value={value}>{children}</ApiContext>;
}

export function useApiContext(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (ctx === null) throw new Error('useApi 要在 ApiProvider 裡面用');
  return ctx;
}

export type ApiState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: ApiError };

// 讀資料用：回傳 loading／success／error 與 reload。deps 變了就重抓；元件卸載後不再 setState。
export function useApi<T>(load: (api: ApiClient) => Promise<T>, deps: readonly unknown[]): ApiState<T> & { reload: () => void } {
  const { api } = useApiContext();
  const [state, setState] = useState<ApiState<T>>({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null, error: null });
    loadRef.current(api).then(
      (data) => { if (alive) setState({ status: 'success', data, error: null }); },
      (e: unknown) => {
        if (alive) setState({ status: 'error', data: null, error: e instanceof ApiError ? e : new ApiError(500, MESSAGES.unknown) });
      },
    );
    return () => { alive = false; };
  }, [api, attempt, ...deps]);

  const reload = useCallback(() => { setAttempt((n) => n + 1); }, []);
  return { ...state, reload };
}
