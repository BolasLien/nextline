import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/base.css';
import { isLocalAuth, LocalAuthGate, Login } from './auth/Login';

const root = document.getElementById('root');
if (root === null) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {/* 最後防線：連側欄都出錯時也不要整頁空白（主內容、預覽各有自己的一層，見 AppShell、IssuePeek） */}
      <ErrorBoundary area="Nextline " fullPage>
        {isLocalAuth() ? window.location.pathname === '/login' ? <Login /> : <LocalAuthGate><App /></LocalAuthGate> : <App />}
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
