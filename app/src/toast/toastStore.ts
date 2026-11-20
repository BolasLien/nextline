// toast 的狀態與計時（components.md 第 15 節）。跟 React 分開，方便用假時鐘測。
// - 一般 4 秒（--duration-toast）；帶「復原」的 10 秒（--duration-toast-undo），底部有倒數條。
// - 錯誤不自動消失，直到關掉或重試成功。
// - 滑過或 focus 時暫停計時（WCAG 2.2.1），離開後用剩下的時間繼續。
// - 按「復原」後同一則改成「已復原」，1.5 秒後消失。
// - 最多同時 3 則，新的在下；超過時把最舊的拿掉。

export const TOAST_MS = 4000;
export const TOAST_UNDO_MS = 10000;
export const UNDONE_MS = 1500;
export const MAX_TOASTS = 3;

export type ToastKind = 'info' | 'error';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastInput {
  message: string;
  kind?: ToastKind;
  // 一則 toast 最多一個動作（打開、重試、複製…）。
  action?: ToastAction;
  // 有給就是「帶復原」的 toast：10 秒倒數，按下去執行 onUndo。
  onUndo?: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action: ToastAction | null;
  undoable: boolean;
  undone: boolean;
  // 這一則總共要顯示多久（null＝不自動消失），倒數條用它算動畫長度。
  duration: number | null;
  paused: boolean;
}

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

export interface Clock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => { clearTimeout(h); },
};

export class ToastStore {
  private toasts: Toast[] = [];
  private readonly timers = new Map<number, Timer>();
  private readonly undos = new Map<number, () => void | Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;

  constructor(private readonly clock: Clock = realClock) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): readonly Toast[] => this.toasts;

  show(input: ToastInput): number {
    const id = this.nextId++;
    const kind = input.kind ?? 'info';
    const undoable = input.onUndo !== undefined;
    const duration = kind === 'error' ? null : undoable ? TOAST_UNDO_MS : TOAST_MS;
    if (input.onUndo !== undefined) this.undos.set(id, input.onUndo);
    const toast: Toast = { id, message: input.message, kind, action: input.action ?? null, undoable, undone: false, duration, paused: false };
    let next = [...this.toasts, toast];
    while (next.length > MAX_TOASTS) {
      const [oldest, ...rest] = next;
      if (oldest !== undefined) this.forget(oldest.id);
      next = rest;
    }
    this.toasts = next;
    if (duration !== null) this.start(id, duration);
    this.emit();
    return id;
  }

  dismiss(id: number): void {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.forget(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  pause(id: number): void {
    const timer = this.timers.get(id);
    if (timer?.handle == null) return;
    this.clock.clearTimeout(timer.handle);
    timer.remaining -= this.clock.now() - timer.startedAt;
    timer.handle = null;
    this.patch(id, { paused: true });
  }

  resume(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined || timer.handle !== null) return;
    this.start(id, Math.max(0, timer.remaining));
    this.patch(id, { paused: false });
  }

  // 按下去馬上改成「已復原」（畫面由 onUndo 自己先樂觀更新），寫入在背景跑，不等請求回來；
  // 寫入失敗才把這則拿掉、改出錯誤 toast。回傳的 Promise 等寫入結束（測試用）。
  async undo(id: number): Promise<void> {
    const run = this.undos.get(id);
    const toast = this.toasts.find((t) => t.id === id);
    if (run === undefined || toast === undefined || toast.undone) return;
    this.undos.delete(id);
    this.patch(id, { message: '已復原', undone: true, undoable: false, action: null, duration: UNDONE_MS, paused: false });
    this.start(id, UNDONE_MS);
    try {
      await run();
    } catch (e) {
      this.dismiss(id);
      this.show({ kind: 'error', message: `沒有復原成功：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  // Cmd/Ctrl+Z：復原最近一則還能復原的 toast。沒有就回 false，讓瀏覽器照常處理。
  undoLatest(): boolean {
    const latest = [...this.toasts].reverse().find((t) => t.undoable && !t.undone);
    if (latest === undefined) return false;
    void this.undo(latest.id);
    return true;
  }

  private start(id: number, ms: number): void {
    this.clearTimer(id);
    const handle = this.clock.setTimeout(() => { this.dismiss(id); }, ms);
    this.timers.set(id, { handle, remaining: ms, startedAt: this.clock.now() });
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer?.handle != null) this.clock.clearTimeout(timer.handle);
    this.timers.delete(id);
  }

  private forget(id: number): void {
    this.clearTimer(id);
    this.undos.delete(id);
  }

  private patch(id: number, changes: Partial<Toast>): void {
    this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, ...changes } : t));
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
