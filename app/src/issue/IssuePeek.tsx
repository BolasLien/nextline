// 右側預覽面板（components.md 第 14 節）：網址 ?peek=NX-12。看板仍可操作（不是 modal）。
// 開啟時焦點到標題，Esc 或「關閉」收起並把焦點還給原本那張卡片；右上角可以展開成整頁 /issues/NX-12。
// 手機不開預覽（AppShell 直接轉到整頁）。
import { useCallback, useEffect, useId, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { isTyping } from '../shell/actions';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { IssueDetailView } from './IssueDetail';

export function IssuePeek({ issueRef }: { issueRef: string }) {
  const [params, setParams] = useSearchParams();
  const headingId = useId();
  const asideRef = useRef<HTMLElement>(null);

  const close = useCallback(() => {
    // 焦點先還給看板上那張卡片（卡片一直都在），再收起面板
    const n = /(\d+)$/.exec(issueRef)?.[1];
    if (n !== undefined) document.querySelector<HTMLElement>(`.nl-card[data-n="${n}"] .hit`)?.focus({ preventScroll: true });
    setParams((p) => {
      const q = new URLSearchParams(p);
      q.delete('peek');
      return q;
    });
  }, [issueRef, setParams]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || isTyping(e.target)) return;
      if (document.querySelector('.nl-menu') !== null) return;
      e.preventDefault();
      close();
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [close]);

  const peekHref = (identifier: string) => {
    const q = new URLSearchParams(params);
    q.set('peek', identifier);
    return `?${q.toString()}`;
  };

  return (
    <aside ref={asideRef} className="nl-peek app-peek" role="dialog" aria-labelledby={headingId} data-peek={issueRef}>
      <ErrorBoundary key={issueRef} area="預覽">
        <IssueDetailView
          issueRef={issueRef}
          layout="peek"
          headingId={headingId}
          links={{ issue: peekHref, expand: `/issues/${issueRef}` }}
          onClose={close}
          onLoaded={() => {
            asideRef.current?.scrollTo({ top: 0 });
            document.getElementById(headingId)?.focus({ preventScroll: true });
          }}
        />
      </ErrorBoundary>
    </aside>
  );
}
