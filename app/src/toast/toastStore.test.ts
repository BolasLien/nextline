import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOASTS, TOAST_MS, TOAST_UNDO_MS, ToastStore, UNDONE_MS } from './toastStore';

let store: ToastStore;

beforeEach(() => {
  vi.useFakeTimers();
  store = new ToastStore({
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => { clearTimeout(h); },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  it('一般 toast 4 秒後消失', () => {
    store.show({ message: '已複製' });
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('帶復原的 toast 倒數 10 秒；按復原後執行 onUndo、改成「已復原」1.5 秒後消失', async () => {
    const onUndo = vi.fn();
    const id = store.show({ message: 'NX-12 移到 Done', onUndo });
    expect(store.getSnapshot()[0]).toMatchObject({ undoable: true, duration: TOAST_UNDO_MS });
    vi.advanceTimersByTime(5000);
    await store.undo(id);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()[0]).toMatchObject({ message: '已復原', undone: true, undoable: false });
    // 再按一次不會重複執行
    await store.undo(id);
    expect(onUndo).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UNDONE_MS);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('沒按復原時 10 秒後消失，onUndo 不會被呼叫', () => {
    const onUndo = vi.fn();
    store.show({ message: 'x', onUndo });
    vi.advanceTimersByTime(TOAST_UNDO_MS);
    expect(store.getSnapshot()).toHaveLength(0);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('滑過時暫停，離開後用剩下的時間繼續', () => {
    const id = store.show({ message: 'x', onUndo: () => undefined });
    vi.advanceTimersByTime(6000);
    store.pause(id);
    expect(store.getSnapshot()[0]?.paused).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.resume(id);
    vi.advanceTimersByTime(TOAST_UNDO_MS - 6000 - 1);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('錯誤 toast 不自動消失，要自己關', () => {
    const id = store.show({ kind: 'error', message: '沒存到' });
    vi.advanceTimersByTime(600000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.dismiss(id);
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('最多 3 則，新的在下，超過時拿掉最舊的', () => {
    for (let i = 1; i <= MAX_TOASTS + 1; i++) store.show({ message: `第 ${String(i)} 則` });
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['第 2 則', '第 3 則', '第 4 則']);
  });

  it('Cmd/Ctrl+Z 復原最近一則還能復原的', async () => {
    const first = vi.fn();
    const second = vi.fn();
    store.show({ message: 'a', onUndo: first });
    store.show({ message: 'b', onUndo: second });
    store.show({ message: 'c' });
    expect(store.undoLatest()).toBe(true);
    await vi.runOnlyPendingTimersAsync();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('沒有能復原的 toast 時 undoLatest 回 false', () => {
    store.show({ message: 'x' });
    expect(store.undoLatest()).toBe(false);
  });

  it('按復原馬上變「已復原」，不等寫入回來（NX-160）', async () => {
    let finish: () => void = () => undefined;
    const id = store.show({ message: 'NX-12 移到 Done', onUndo: () => new Promise<void>((r) => { finish = r; }) });
    const pending = store.undo(id);
    expect(store.getSnapshot()[0]).toMatchObject({ message: '已復原', undone: true });
    finish();
    await pending;
    expect(store.getSnapshot()[0]).toMatchObject({ message: '已復原' });
  });

  it('寫入比「已復原」顯示時間還久才失敗：照樣出錯誤 toast', async () => {
    let fail: (e: Error) => void = () => undefined;
    const id = store.show({ message: 'x', onUndo: () => new Promise<void>((_, rej) => { fail = rej; }) });
    const pending = store.undo(id);
    vi.advanceTimersByTime(UNDONE_MS);
    expect(store.getSnapshot()).toHaveLength(0);
    fail(new Error('網路斷了'));
    await pending;
    expect(store.getSnapshot()).toMatchObject([{ kind: 'error', message: '沒有復原成功：網路斷了' }]);
  });

  it('復原失敗時改顯示錯誤 toast', async () => {
    const id = store.show({ message: 'x', onUndo: () => Promise.reject(new Error('網路斷了')) });
    await store.undo(id);
    expect(store.getSnapshot()).toMatchObject([{ kind: 'error', message: '沒有復原成功：網路斷了' }]);
  });
});
