import { describe, expect, it } from 'vitest';
import { parseTheme, readTheme, saveTheme, THEME_KEY } from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

describe('深淺色偏好', () => {
  it('只認 light、dark，其他都當跟系統', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('blue')).toBe('system');
    expect(parseTheme(null)).toBe('system');
  });

  it('存在 localStorage；選跟系統時把 key 拿掉', () => {
    const s = memoryStorage();
    saveTheme(s, 'dark');
    expect(s.data.get(THEME_KEY)).toBe('dark');
    expect(readTheme(s)).toBe('dark');
    saveTheme(s, 'system');
    expect(s.data.has(THEME_KEY)).toBe(false);
    expect(readTheme(s)).toBe('system');
  });

  it('localStorage 丟例外時不會壞，當成跟系統', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(readTheme(broken)).toBe('system');
    expect(() => { saveTheme(broken, 'light'); }).not.toThrow();
  });
});
