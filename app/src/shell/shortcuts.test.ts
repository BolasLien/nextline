import { describe, expect, it } from 'vitest';
import { decideShortcut, G_TIMEOUT_MS, type KeyLike, type ShortcutContext } from './shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
const ctx = (over: Partial<ShortcutContext> = {}): ShortcutContext => ({ typing: false, modalOpen: false, paletteOpen: false, gAt: null, now: 10_000, ...over });

describe('全域快捷鍵', () => {
  it('Cmd+K、Ctrl+K 開指令面板；焦點在輸入框也有效', () => {
    expect(decideShortcut(key('k', { metaKey: true }), ctx())).toEqual({ type: 'palette' });
    expect(decideShortcut(key('K', { ctrlKey: true }), ctx({ typing: true }))).toEqual({ type: 'palette' });
    expect(decideShortcut(key('k', { metaKey: true }), ctx({ paletteOpen: true }))).toEqual({ type: 'palette' });
  });

  it('開票對話框開著時 Cmd+K 不搶', () => {
    expect(decideShortcut(key('k', { metaKey: true }), ctx({ modalOpen: true }))).toBeNull();
  });

  it('C 開票；焦點在輸入框時不觸發', () => {
    expect(decideShortcut(key('c'), ctx())).toEqual({ type: 'create' });
    expect(decideShortcut(key('c'), ctx({ typing: true }))).toBeNull();
    expect(decideShortcut(key('c', { metaKey: true }), ctx())).toBeNull();
    expect(decideShortcut(key('C', { shiftKey: true }), ctx())).toBeNull();
  });

  it('指令面板或對話框開著時，單鍵都不觸發', () => {
    for (const k of ['c', 'g', '?']) {
      expect(decideShortcut(key(k, { shiftKey: k === '?' }), ctx({ paletteOpen: true }))).toBeNull();
      expect(decideShortcut(key(k, { shiftKey: k === '?' }), ctx({ modalOpen: true }))).toBeNull();
    }
  });

  it('? 顯示快捷鍵說明（Shift+/）；輸入框裡不觸發', () => {
    expect(decideShortcut(key('?', { shiftKey: true }), ctx())).toEqual({ type: 'help' });
    expect(decideShortcut(key('?', { shiftKey: true }), ctx({ typing: true }))).toBeNull();
  });

  it('G 接 B／I／M 跳頁；三區拿掉了，G 接 Z 不跳', () => {
    expect(decideShortcut(key('g'), ctx())).toEqual({ type: 'g' });
    const after = ctx({ gAt: 9_500 });
    expect(decideShortcut(key('b'), after)).toEqual({ type: 'go', path: '/' });
    expect(decideShortcut(key('i'), after)).toEqual({ type: 'go', path: '/issues' });
    expect(decideShortcut(key('m'), after)).toEqual({ type: 'go', path: '/issues?status=in_review' });
    expect(decideShortcut(key('z'), after)).toBeNull();
  });

  it('G 之後太久、或沒按 G，B／I 不跳；G 接 C 照樣開票', () => {
    expect(decideShortcut(key('i'), ctx())).toBeNull();
    expect(decideShortcut(key('i'), ctx({ gAt: 10_000 - G_TIMEOUT_MS }))).toBeNull();
    expect(decideShortcut(key('c'), ctx({ gAt: 9_900 }))).toEqual({ type: 'create' });
  });

  it('G 接 I 在輸入框裡不跳', () => {
    expect(decideShortcut(key('g'), ctx({ typing: true }))).toBeNull();
    expect(decideShortcut(key('i'), ctx({ typing: true, gAt: 9_900 }))).toBeNull();
  });
});
