// 描述、comment 的 Markdown。轉換用 worker/web/markdown.ts 的 renderMarkdown：
// 原文裡的 HTML 一律跳脫成文字，只輸出固定的標籤；連結只接受 http(s)、mailto 與站內路徑。所以可以直接放進 innerHTML。
import { type KeyboardEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../../../worker/web/markdown';
import { TOUCH_QUERY, useMediaQuery } from '../ui/useMediaQuery';
import './markdown.css';

export function Markdown({ source, empty }: { source: string; empty?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  if (source.trim() === '') return empty === undefined ? null : <p className="md-empty">{empty}</p>;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// textarea 跟內容一樣高（不出現內捲軸）；最小高度由 CSS 決定（.md-editor--tall 是描述用的大框）。
export function autoGrow(el: HTMLTextAreaElement): void {
  const style = getComputedStyle(el);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  el.style.height = 'auto';
  el.style.height = `${String(el.scrollHeight + (Number.isFinite(border) ? border : 0))}px`;
}

// 可以切換「編輯／預覽」的 Markdown 輸入框。Cmd/Ctrl+Enter 送出；onCancel 有給時 Esc 取消。
// hint 是快捷鍵說明（「⌘↵ 送出」），只在有鍵盤的裝置接在 placeholder 後面；手機不顯示。
// heading 有給時，輸入框上方是一列「標題（左）＋編輯／預覽（右）」（開票對話框的描述，NX-161）。
export function MarkdownEditor({ value, onChange, onSubmit, onCancel, label, heading, placeholder, hint, autoFocus, required, invalid, describedBy, tall = false }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  label: string;
  heading?: string;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  // 描述用：最小高度 12 行（螢幕矮時最多半個畫面）
  tall?: boolean;
}) {
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const id = useId();
  const touch = useMediaQuery(TOUCH_QUERY);
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (tab === 'edit' && area.current !== null) autoGrow(area.current);
  }, [value, tab]);
  const shownPlaceholder = placeholder === undefined ? undefined : hint === undefined || touch ? placeholder : `${placeholder}（${hint}）`;

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'Escape' && onCancel !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }
  const tabs = (
    <div className="md-tabs" role="tablist" aria-label={`${label}：編輯或預覽`}>
      <button type="button" role="tab" id={`${id}-t-edit`} aria-selected={tab === 'edit'} aria-controls={`${id}-p`} onClick={() => { setTab('edit'); }}>
        編輯
      </button>
      <button type="button" role="tab" id={`${id}-t-preview`} aria-selected={tab === 'preview'} aria-controls={`${id}-p`} onClick={() => { setTab('preview'); }}>
        預覽
      </button>
    </div>
  );
  return (
    <div className={tall ? 'md-editor md-editor--tall' : 'md-editor'} onKeyDown={onKeyDown}>
      {heading === undefined ? tabs : (
        <div className="md-editor-h">
          <span className="md-editor-title" aria-hidden="true">{heading}</span>
          {tabs}
        </div>
      )}
      <div id={`${id}-p`} role="tabpanel" aria-labelledby={`${id}-t-${tab}`}>
        {tab === 'edit' ? (
          <textarea
            ref={area}
            className="nl-input"
            aria-label={label}
            value={value}
            placeholder={shownPlaceholder}
            autoFocus={autoFocus}
            aria-required={required}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            onChange={(e) => { onChange(e.target.value); }}
          />
        ) : (
          <div className="md-preview" tabIndex={0}>
            <Markdown source={value} empty="沒有內容" />
          </div>
        )}
      </div>
    </div>
  );
}
