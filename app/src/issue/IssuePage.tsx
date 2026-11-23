// /issues/:ref 票詳細整頁。舊編號（/issues/ABC-150）載入後網址換成 NX 編號。手機點卡片直接進這裡。
import { useCallback, useEffect, useId } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { IssueDetail } from '../api/types';
import { IssueDetailView } from './IssueDetail';

export function IssuePage() {
  const { ref = '' } = useParams();
  const navigate = useNavigate();
  const headingId = useId();

  useEffect(() => {
    const prev = document.title;
    document.title = `${ref.toUpperCase()} · Nextline`;
    return () => { document.title = prev; };
  }, [ref]);

  const onLoaded = useCallback(
    (issue: IssueDetail) => {
      if (issue.identifier.toLowerCase() !== ref.toLowerCase()) void navigate(`/issues/${issue.identifier}`, { replace: true });
    },
    [navigate, ref],
  );

  return <IssueDetailView key={ref} issueRef={ref} layout="page" headingId={headingId} links={{ issue: (id) => `/issues/${id}` }} onLoaded={onLoaded} />;
}
