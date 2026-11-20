import { THEME_OPTIONS } from './theme';
import { useTheme } from './ThemeProvider';
import './theme-switch.css';

// 設計系統的分段控制（overview 的 .nl-seg）。
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="nl-seg" role="group" aria-label="外觀">
      {THEME_OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={theme === o.value} onClick={() => { setTheme(o.value); }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
