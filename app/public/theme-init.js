// 跟 src/theme/theme.ts 同一個 key 與值：light、dark；沒存或讀不到就跟系統（不設 data-theme）。
try {
  var saved = localStorage.getItem('nextline.theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
} catch {
  // 私密視窗或封鎖網站資料時讀不到，跟系統即可。
}
