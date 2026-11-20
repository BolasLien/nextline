// 「?」快捷鍵說明（docs/design/ia/README.md 第 5 段，只列目前做好的）。Esc 或關閉按鈕收起，焦點回到開啟前的地方。
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import '../create/create.css';
import './palette.css';

const ROWS: readonly { keys: readonly string[][]; label: string }[] = [
  { keys: [['⌘', 'K'], ['Ctrl', 'K']], label: '指令面板：找票、跳頁、改狀態' },
  { keys: [['C']], label: '建立票' },
  { keys: [['⌘', 'Z'], ['Ctrl', 'Z']], label: '復原最近一次的修改' },
  { keys: [['Esc']], label: '關閉最上層（面板、預覽、選單）' },
  { keys: [['G', 'B']], label: '跳到看板' },
  { keys: [['G', 'I']], label: '跳到全部的票' },
  { keys: [['G', 'M']], label: '跳到等你' },
  { keys: [['⌘', '↵']], label: '送出開票、comment；預覽裡＝通過' },
  { keys: [['?']], label: '顯示這份說明' },
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);

  return createPortal(
    <div className="nl-modal-scrim kb-help-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="nl-modal kb-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === '?') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Tab') {
            e.preventDefault();
          }
        }}
      >
        <div className="hd">
          <h2 id={headingId}>快捷鍵</h2>
          <button ref={closeRef} type="button" className="nl-btn nl-btn--icon nl-btn--sm" aria-label="關閉（Esc）" title="關閉（Esc）" onClick={onClose}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <dl className="bd kb-list">
          {ROWS.map((r) => (
            <div key={r.label} className="kb-row">
              <dt>
                {r.keys.map((combo, n) => (
                  <span key={combo.join('+')} className="combo">
                    {n > 0 && <span className="or">或</span>}
                    {combo.map((k) => <kbd key={k} className="nl-kbd">{k}</kbd>)}
                  </span>
                ))}
              </dt>
              <dd>{r.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
