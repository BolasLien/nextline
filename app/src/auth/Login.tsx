import { useEffect, useState, type ReactNode } from 'react';
import { Logo } from '../ui/Icon';
import '../ui/button.css';
import './auth.css';

export function isLocalAuth(): boolean { return typeof document !== 'undefined' && document.documentElement.dataset.auth === 'local'; }

export function loginUrl(): string { return `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}&expired=1`; }

// Vite serves the public shell directly; keep its first visit on the same login flow.
export function LocalAuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch('/auth/session').then((response) => {
      if (!active) return;
      if (response.status === 401) window.location.replace(loginUrl());
      else if (response.ok) setReady(true);
      else setError(true);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  if (ready) return children;
  return <main className="login-page"><p role="status">{error ? '無法連線到 Nextline，請確認服務已啟動後重新整理。' : '正在開啟工作空間…'}</p></main>;
}

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.startsWith('/login') || /[\r\n]/.test(value)) return '/';
  return value;
}

export function Login() {
  const params = new URLSearchParams(window.location.search);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) {
        setError(response.status === 429 ? '嘗試次數太多，請稍等一分鐘再登入。' : response.status === 401 ? '密碼不正確，請再試一次。' : '登入失敗，請確認服務設定後再試。');
        setPassword(''); return;
      }
      window.location.assign(safeReturnTo(params.get('returnTo')));
    } catch { setError('無法連線到 Nextline，請確認服務已啟動。'); }
    finally { setBusy(false); }
  }
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><Logo />Nextline</div>
        <h1 id="login-title">登入你的工作空間</h1>
        <p>{params.has('expired') ? '登入後會回到剛才的頁面。' : '輸入初始化時設定的密碼。'}</p>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label htmlFor="password">密碼</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} autoFocus value={password} onChange={(event) => { setPassword(event.target.value); }} aria-invalid={error !== ''} aria-describedby={error ? 'login-error' : undefined} />
          {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
          <button type="submit" className="nl-btn nl-btn--primary nl-btn--lg" disabled={busy} aria-busy={busy}>{busy ? '登入中…' : '登入'}</button>
        </form>
        <p className="login-help">忘記密碼？在跑 Nextline 的電腦上，到 repo 資料夾執行 <code>npm run selfhost:password</code> 重設。</p>
      </section>
    </main>
  );
}

export function LogoutButton() {
  const [error, setError] = useState('');
  if (!isLocalAuth()) return null;
  async function logout() {
    try {
      const response = await fetch('/auth/logout', { method: 'POST' });
      if (!response.ok) { setError('登出失敗，請再試一次。'); return; }
      window.location.assign('/login');
    } catch { setError('連線中斷，尚未登出。'); }
  }
  return <div className="logout"><button className="nl-btn nl-btn--secondary nl-btn--sm" type="button" onClick={() => { void logout(); }}>登出</button>{error && <p role="alert">{error}</p>}</div>;
}
