// 畫面出來前先套上深淺色：網址 ?theme=light|dark 優先（截圖用），其次是上次選的，都沒有就跟系統。
(function () {
  var t = null;
  try {
    t = new URLSearchParams(location.search).get('theme') || localStorage.getItem('nextline-site.theme');
  } catch {
    // 私密視窗或封鎖網站資料時讀不到，跟系統即可。
  }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
