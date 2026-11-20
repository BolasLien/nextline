import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { applyTheme, readTheme, saveTheme, type ThemeChoice } from './theme';

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function ThemeProvider({ children, initial }: { children: ReactNode; initial?: ThemeChoice }) {
  const [theme, setState] = useState<ThemeChoice>(() => initial ?? readTheme(browserStorage()));
  const setTheme = useCallback((choice: ThemeChoice) => {
    setState(choice);
    saveTheme(browserStorage(), choice);
    applyTheme(document.documentElement, choice);
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme 要在 ThemeProvider 裡面用');
  return ctx;
}
