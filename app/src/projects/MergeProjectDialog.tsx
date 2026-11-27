// 合併 Project 對話框：把目前 Project 底下所有票（含已封存）移轉到另一個 Project，
// 可選是否把非空說明附加到目標說明，最後移除來源 Project。無法復原，因此以確認對話框把關。
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApiContext } from '../api/ApiProvider';
import type { Project, ProjectMergeResult } from '../api/types';
import { useOpenIssues } from '../issues/OpenIssuesProvider';
import { Icon } from '../ui/Icon';
import { sortProjects } from './projects';
import { useProjects } from './ProjectsProvider';
import '../ui/button.css';
import '../ui/input.css';
import '../create/create.css';
import './projects.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface IssueCountState {
  status: 'loading' | 'ready' | 'error';
  total: number;
  archived: number;
}

export function MergeProjectDialog({ project, onClose, onMerged }: {
  project: Project;
  onClose: () => void;
  onMerged: (result: ProjectMergeResult) => void;
}) {
  const { api } = useApiContext();
  const projects = useProjects();
  const open = useOpenIssues();
  const headingId = useId();
  const targetFieldId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(
    () => sortProjects((projects.projects ?? []).filter((p) => p.id !== project.id)),
    [projects.projects, project.id],
  );
  const hasDescription = project.description.trim() !== '';
  const [targetId, setTargetId] = useState<string>('');
  const [appendDescription, setAppendDescription] = useState(hasDescription);
  const [counts, setCounts] = useState<IssueCountState>({ status: 'loading', total: 0, archived: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 背景 inert，跟新增／編輯 Project 對話框一樣
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.app, .nl-tabbar, .nl-fab')];
    for (const el of els) el.inert = true;
    return () => { for (const el of els) el.inert = false; };
  }, []);

  // 取得來源 Project 底下實際會移轉的票數（含已完成與已封存）
  useEffect(() => {
    let alive = true;
    async function loadCounts() {
      let total = 0;
      let archived = 0;
      let offset = 0;
      try {
        for (;;) {
          const page = await api.listIssues({ project: project.id, archived: 'include', limit: 200, offset });
          total += page.issues.length;
          for (const issue of page.issues) {
            if (issue.archived_at !== null) archived++;
          }
          if (!page.has_more) break;
          offset += page.limit;
        }
        if (alive) setCounts({ status: 'ready', total, archived });
      } catch {
        if (alive) setCounts({ status: 'error', total: 0, archived: 0 });
      }
    }
    void loadCounts();
    return () => { alive = false; };
  }, [api, project.id]);

  const selectedTarget = candidates.find((p) => String(p.id) === targetId) ?? null;

  async function submit() {
    if (busy || selectedTarget === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.mergeProject(project.id, {
        target_project_id: selectedTarget.id,
        append_description: hasDescription ? appendDescription : false,
      });
      projects.applyMerge(project.id, result.target);
      open.reload();
      onMerged(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const countText =
    counts.status === 'loading'
      ? '計算票數中…'
      : counts.status === 'error'
        ? '來源底下的所有票（含已封存）都會移轉到目標 Project。'
        : counts.total === 0
          ? '這個 Project 目前沒有票。'
          : counts.archived > 0
            ? `將移轉 ${String(counts.total)} 張票（含 ${String(counts.archived)} 張已封存）。`
            : `將移轉 ${String(counts.total)} 張票。`;

  return createPortal(
    <div className="nl-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={modalRef} className="nl-modal merge-modal" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={onKeyDown}>
        <div className="hd">
          <h2 id={headingId}>合併 Project</h2>
          <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="關閉（Esc）" title="關閉（Esc）" onClick={onClose} disabled={busy}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className="bd">
          <p className="merge-summary" data-merge-summary>
            將「<strong>{project.name}</strong>」合併到其他 Project。{countText}
          </p>
          <div className="nl-field">
            <label className="nl-label" htmlFor={targetFieldId}>目標 Project</label>
            <select
              id={targetFieldId}
              name="target-project"
              className="nl-input"
              autoFocus
              disabled={busy || candidates.length === 0}
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); setError(null); }}
            >
              <option value="">請選擇要保留的目標 Project…</option>
              {candidates.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
          </div>
          {hasDescription && (
            <label className="merge-check">
              <input
                type="checkbox"
                name="append-description"
                checked={appendDescription}
                disabled={busy}
                onChange={(e) => { setAppendDescription(e.target.checked); }}
              />
              <span>將「{project.name}」的說明附加到目標 Project 說明</span>
            </label>
          )}
          <div className="merge-warn" role="note">
            <Icon name="alert" size="sm" />
            <span>合併後「{project.name}」會被移除且無法復原；底下的票會全部移到目標 Project，原本的更新時間不受影響。</span>
          </div>
          {error !== null && (
            <p className="nl-error" role="alert">
              <Icon name="alert" size="sm" />
              合併失敗：{error}
            </p>
          )}
        </div>
        <div className="ft">
          <span className="sp" />
          <button type="button" className="nl-btn nl-btn--secondary" onClick={onClose} disabled={busy}>
            取消
            <span className="nl-kbd">Esc</span>
          </button>
          <button
            type="button"
            className="nl-btn nl-btn--danger"
            data-confirm-merge
            aria-busy={busy}
            disabled={busy || selectedTarget === null}
            onClick={() => void submit()}
          >
            {busy ? '合併中…' : '確認合併'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
