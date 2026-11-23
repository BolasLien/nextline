// 官網首頁的動畫：區塊捲進畫面時浮上來；首屏的示意卡片在四欄之間走，標出現在輪到誰。深淺色切換在 site.js。
(function () {
  // 有 JS 才先藏起來等浮上來；沒有 JS 時內容照常顯示。
  document.documentElement.classList.add('js');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var rises = document.querySelectorAll('.rise');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    rises.forEach(function (el) {
      io.observe(el);
    });
  } else {
    rises.forEach(function (el) {
      el.classList.add('in');
    });
  }

  var card = document.getElementById('hc');
  var cols = document.querySelectorAll('.hcol');
  var whose = document.getElementById('whose');
  var whoseT = document.getElementById('whoseT');
  var nx = document.getElementById('hcn');
  var nxT = document.getElementById('hcnT');
  if (!card || !whose || !whoseT || !nx || !nxT || cols.length !== 4) return;

  var states = [
    { c: 0, me: true, t: '你開的票', n: '' },
    { c: 1, me: false, t: 'agent 在做', n: 'kakeibo agent 畫圓餅圖、跑測試' },
    { c: 2, me: true, t: '輪到你', n: '你打開 /report 看 10 月的圓餅圖' },
    { c: 3, me: true, t: '完成', n: '' },
  ];

  function show(s) {
    var col = cols[s.c];
    col.insertBefore(card, col.querySelector('h3').nextSibling);
    cols.forEach(function (c) {
      c.classList.toggle('lit', c === col && s.c !== 3);
    });
    var av = whose.querySelector('.av');
    av.className = 'av ' + (s.me ? 'me' : 'ai');
    av.textContent = s.me ? '你' : 'AI';
    whoseT.textContent = s.t;
    nx.hidden = !s.n;
    nxT.textContent = s.n;
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
  }

  if (reduce) {
    show(states[2]);
    return;
  }
  var i = 0;
  show(states[0]);
  setInterval(function () {
    // 分頁在背景時不動，回來時接著走。
    if (document.hidden) return;
    i = (i + 1) % states.length;
    show(states[i]);
  }, 2200);
})();
