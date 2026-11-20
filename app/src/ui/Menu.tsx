// 選單（components.md 第 19 節）：卡片「更多」、手機看板的「Backlog 與 Canceled」、列表的篩選。
// 浮層用 portal 放在 body、position: fixed，不會被看板的橫向捲動框裁掉。
// 鍵盤：開啟後焦點到第一項；↑↓／Home／End 移動、Enter 執行、Esc 關閉並回到觸發按鈕、Tab 關閉。
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import './menu.css';

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: IconName;
  // 圖示的顏色（例：狀態色 var(--status-done-solid)）
  iconColor?: string;
  right?: ReactNode;
  // 有給就是可勾選的項目（menuitemcheckbox），右側打勾
  checked?: boolean;
  // 選了不關閉（複選的篩選）
  keepOpen?: boolean;
  onSelect: () => void;
}

export interface MenuGroup {
  // 群組標題（例：「移到…」）；沒有就不顯示
  title?: string;
  items: MenuItem[];
}

const GAP = 6;
const ITEM = '[role="menuitem"], [role="menuitemcheckbox"]';
const EDGE = 8;

export function Menu({ anchor, label, groups, onClose }: {
  anchor: HTMLElement;
  label: string;
  groups: MenuGroup[];
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 靠觸發按鈕的右下方；超出視窗就往左、往上翻。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    let left = a.right - m.width;
    if (left < EDGE) left = Math.min(a.left, vw - m.width - EDGE);
    left = Math.max(EDGE, Math.min(left, vw - m.width - EDGE));
    let top = a.bottom + GAP;
    if (top + m.height > vh - EDGE && a.top - GAP - m.height >= EDGE) top = a.top - GAP - m.height;
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(ITEM)?.focus();
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose({ restoreFocus: false });
    }
    function onScroll(e: Event) {
      if (ref.current?.contains(e.target as Node)) return;
      onClose({ restoreFocus: false });
    }
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => { items[(n + items.length) % items.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focus(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focus(i - 1); break;
      case 'Home': e.preventDefault(); focus(0); break;
      case 'End': e.preventDefault(); focus(items.length - 1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); onClose(); break;
      case 'Tab': onClose(); break;
      default: break;
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="nl-menu"
      role="menu"
      aria-label={label}
      style={pos === null ? { visibility: 'hidden', top: 0, left: 0 } : { top: pos.top, left: pos.left }}
      onKeyDown={onKeyDown}
    >
      {groups.map((g, gi) => (
        <div key={g.title ?? gi} role="group" aria-label={g.title} className="grp">
          {g.title !== undefined && <div className="ttl" aria-hidden="true">{g.title}</div>}
          {g.items.map((item) => (
            <button
              key={item.key}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              className="nl-menu-item"
              tabIndex={-1}
              onClick={() => {
                if (item.keepOpen !== true) onClose();
                item.onSelect();
              }}
            >
              {item.icon !== undefined && (
                <span className="ic" style={item.iconColor === undefined ? undefined : { color: item.iconColor }}>
                  <Icon name={item.icon} size="sm" />
                </span>
              )}
              <span className="lbl">{item.label}</span>
              {item.right !== undefined && <span className="right">{item.right}</span>}
              {item.checked !== undefined && (
                <span className="check" aria-hidden="true">
                  {item.checked && <Icon name="check" size="sm" />}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
