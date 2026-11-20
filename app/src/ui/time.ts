// 時間的顯示：變更紀錄、comment 用「3 分鐘前」，滑過（title）看完整時間。
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  if (diff < MIN) return '剛剛';
  if (diff < HOUR) return `${String(Math.floor(diff / MIN))} 分鐘前`;
  if (diff < DAY) return `${String(Math.floor(diff / HOUR))} 小時前`;
  if (diff < 7 * DAY) return `${String(Math.floor(diff / DAY))} 天前`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const md = `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
  return sameYear ? md : `${String(d.getFullYear())}/${md}`;
}

export function fullTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
