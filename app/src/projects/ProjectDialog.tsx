// 新增／修改 Project 的對話框（NX-160）：跟開票對話框同一套 .nl-modal。
// - 新增（/projects 的「新增 Project」）、修改（Project 頁的「編輯」）：名稱（必填）、說明。
//   Project 沒有狀態（NX-165）。
// 顏色：API 沒有顏色欄位，照現在的規則用 id 自動分配（shell/sprints.ts 的 projectColorClass），不另外存。
// Cmd/Ctrl+Enter 送出、Esc 關閉；送出失敗時錯誤顯示在底列上方，內容保留。
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApiContext } from '../api/ApiProvider';
import type { Project } from '../api/types';
import { MarkdownEditor } from '../issue/Markdown';
import { Icon } from '../ui/Icon';
import { projectNameError } from './projects';
import { useProjects } from './ProjectsProvider';
import '../ui/button.css';
import '../ui/input.css';
import '../create/create.css';
import './projects.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ProjectDialog({ project, onClose, onSaved }: {
  // 有給是修改這個 Project；沒給是新增
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const { api } = useApiContext();
  const projects = useProjects();
  const editing = project !== undefined;
  const headingId = useId();
  const nameErrorId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 背景 inert，跟開票對話框一樣
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>('.app, .nl-tabbar, .nl-fab')];
    for (const el of els) el.inert = true;
    return () => { for (const el of els) el.inert = false; };
  }, []);

  async function submit() {
    if (busy) return;
    const problem = projectNameError(name, projects.projects ?? [], project?.id ?? null);
    if (problem !== null) {
      setNameError(problem);
      modalRef.current?.querySelector<HTMLInputElement>('input[name="project-name"]')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), description };
      const saved = editing ? await api.updateProject(project.id, body) : await api.createProject(body);
      projects.upsert(saved);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
      if (!e.defaultPrevented) {
        e.preventDefault();
        void submit();
      }
      return;
    }
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

  const title = editing ? '編輯 Project' : '新增 Project';
  return createPortal(
    <div className="nl-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={modalRef} className="nl-modal project-modal" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={onKeyDown}>
        <div className="hd">
          <h2 id={headingId}>{title}</h2>
          <button type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="關閉（Esc）" title="關閉（Esc）" onClick={onClose} disabled={busy}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className="bd">
          <div className="nl-field">
            <label className="nl-label" htmlFor={`${headingId}-name`}>名稱（必填）</label>
            <input
              id={`${headingId}-name`}
              name="project-name"
              className="nl-input"
              autoComplete="off"
              autoFocus
              aria-required="true"
              aria-invalid={nameError !== null}
              aria-describedby={nameError === null ? undefined : nameErrorId}
              disabled={busy}
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            {nameError !== null && (
              <p className="nl-error" id={nameErrorId}>
                <Icon name="alert" size="sm" />
                {nameError}
              </p>
            )}
          </div>
          <MarkdownEditor label="說明（Markdown）" value={description} placeholder="說明（選填，支援 Markdown）" onChange={setDescription} onSubmit={() => void submit()} />
          {error !== null && (
            <p className="nl-error" role="alert">
              <Icon name="alert" size="sm" />
              {editing ? '儲存失敗' : '建立失敗'}：{error}
            </p>
          )}
        </div>
        <div className="ft">
          <span className="sp" />
          <button type="button" className="nl-btn nl-btn--secondary" onClick={onClose} disabled={busy}>
            取消
            <span className="nl-kbd">Esc</span>
          </button>
          <button type="button" className="nl-btn nl-btn--primary" aria-keyshortcuts="Meta+Enter Control+Enter" aria-busy={busy} disabled={busy || name.trim() === ''} onClick={() => void submit()}>
            {busy ? (editing ? '儲存中…' : '建立中…') : editing ? '儲存' : '建立'}
            <span className="nl-kbd">⌘↵</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
