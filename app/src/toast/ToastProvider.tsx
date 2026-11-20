import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '../ui/Icon';
import { type Toast, type ToastInput, ToastStore } from './toastStore';
import './toast.css';

const ToastContext = createContext<ToastStore | null>(null);

export function ToastProvider({ children, store: given }: { children: ReactNode; store?: ToastStore }) {
  const [store] = useState(() => given ?? new ToastStore());

  // Cmd/Ctrl+Z 等於按最近一則的「復原」；焦點在輸入框時不攔，留給輸入框自己的復原。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'z' || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (store.undoLatest()) e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [store]);

  return (
    <ToastContext value={store}>
      {children}
      <Toaster store={store} />
    </ToastContext>
  );
}

export function useToast(): { show: (input: ToastInput) => number; dismiss: (id: number) => void } {
  const store = useContext(ToastContext);
  if (store === null) throw new Error('useToast 要在 ToastProvider 裡面用');
  return { show: (input) => store.show(input), dismiss: (id) => { store.dismiss(id); } };
}

function Toaster({ store }: { store: ToastStore }) {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const hasError = toasts.some((t) => t.kind === 'error');
  return (
    <div className="nl-toasts" aria-live={hasError ? 'assertive' : 'polite'} aria-label="通知">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} store={store} />
      ))}
    </div>
  );
}

function ToastItem({ toast, store }: { toast: Toast; store: ToastStore }) {
  const pause = () => { store.pause(toast.id); };
  const resume = () => { store.resume(toast.id); };
  const className = ['nl-toast', toast.kind === 'error' ? 'nl-toast--error' : '', toast.paused ? 'is-paused' : ''].filter(Boolean).join(' ');
  return (
    <div
      className={className}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <Icon name={toast.kind === 'error' ? 'alert' : toast.undone ? 'check' : 'info'} />
      <span className="msg">{toast.message}</span>
      {toast.undoable && (
        <button type="button" className="act" onClick={() => void store.undo(toast.id)}>
          <Icon name="undo" />
          復原
        </button>
      )}
      {!toast.undoable && toast.action !== null && (
        <button
          type="button"
          className="act"
          onClick={() => {
            const action = toast.action;
            store.dismiss(toast.id);
            void action?.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="x" aria-label="關閉通知" onClick={() => { store.dismiss(toast.id); }}>
        <Icon name="x" />
      </button>
      {toast.undoable && <span className="bar" aria-hidden="true" />}
    </div>
  );
}
