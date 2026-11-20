// 官網與文件站的小互動：深淺色切換、複製程式碼、手機目錄、搜尋（⌘K／Ctrl+K）。不依賴任何套件。
(function () {
  var root = document.documentElement;

  // 深淺色：記在 localStorage（讀寫失敗就只在這一頁有效）。
  var themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = root.getAttribute('data-theme');
      var dark = current ? current === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('nextline-site.theme', next);
      } catch {
        // 存不了就算了。
      }
    });
  }

  // 複製程式碼。
  document.querySelectorAll('.code-card .copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pre = btn.nextElementSibling;
      if (!pre || !navigator.clipboard) return;
      navigator.clipboard.writeText(pre.innerText).then(
        function () {
          btn.textContent = '已複製';
          setTimeout(function () {
            btn.textContent = '複製';
          }, 1500);
        },
        function () {
          btn.textContent = '複製失敗';
        },
      );
    });
  });

  // 手機：目錄收在按鈕裡。
  var menu = document.querySelector('[data-menu]');
  var side = document.getElementById('side');
  if (menu && side) {
    menu.addEventListener('click', function () {
      var open = side.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
    });
  }

  // 本頁目錄：捲到哪一段就標哪一段。
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (tocLinks.length > 0 && 'IntersectionObserver' in window) {
    var byId = {};
    tocLinks.forEach(function (a) {
      byId[a.getAttribute('href').slice(1)] = a;
    });
    var mark = function (id) {
      tocLinks.forEach(function (a) {
        if (a === byId[id]) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    };
    mark(tocLinks[0].getAttribute('href').slice(1));
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) mark(e.target.id);
        });
      },
      { rootMargin: '-70px 0px -70% 0px' },
    );
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  // 搜尋：比對標題、段落標題與內文，標題命中排前面。
  var panel = document.getElementById('search-panel');
  var input = document.getElementById('search-input');
  var list = document.getElementById('search-results');
  var data = window.NEXTLINE_SEARCH || [];
  if (!panel || !input || !list) return;
  var base = panel.getAttribute('data-base') || '';
  var selected = 0;

  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function search(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    var out = [];
    data.forEach(function (page) {
      var title = page.title.toLowerCase();
      var text = page.text.toLowerCase();
      var heads = page.headings;
      var score = 0;
      var hit = null;
      var ok = terms.every(function (t) {
        var s = 0;
        if (title.indexOf(t) >= 0) s += 10;
        heads.forEach(function (h) {
          if (h.text.toLowerCase().indexOf(t) >= 0) {
            s += 5;
            if (hit === null) hit = h;
          }
        });
        if (text.indexOf(t) >= 0) s += 1;
        score += s;
        return s > 0;
      });
      if (ok) out.push({ page: page, hit: hit, score: score });
    });
    out.sort(function (a, b) {
      return b.score - a.score;
    });
    return out.slice(0, 12);
  }

  function render() {
    var results = search(input.value);
    selected = 0;
    if (input.value.trim() === '') {
      list.innerHTML = '';
      return;
    }
    if (results.length === 0) {
      list.innerHTML = '<li class="empty">找不到符合的內容</li>';
      return;
    }
    list.innerHTML = results
      .map(function (r, i) {
        var href = base + r.page.url + (r.hit ? '#' + r.hit.id : '');
        var label = r.hit ? r.page.title + ' › ' + r.hit.text : r.page.title;
        var crumb = r.page.crumb ? r.page.crumb : '文件';
        return (
          '<li><a role="option" href="' + esc(href) + '"' + (i === 0 ? ' aria-selected="true"' : '') + '>' +
          esc(label) + '<small>' + esc(crumb) + '</small></a></li>'
        );
      })
      .join('');
  }

  function open() {
    panel.hidden = false;
    input.value = '';
    render();
    input.focus();
  }
  function close() {
    panel.hidden = true;
  }

  document.querySelectorAll('[data-search-open]').forEach(function (b) {
    b.addEventListener('click', open);
  });
  input.addEventListener('input', render);
  panel.addEventListener('click', function (e) {
    if (e.target === panel) close();
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (panel.hidden) open();
      else close();
      return;
    }
    if (panel.hidden) return;
    var links = list.querySelectorAll('a');
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (links.length === 0) return;
      links[selected].removeAttribute('aria-selected');
      selected = (selected + (e.key === 'ArrowDown' ? 1 : links.length - 1)) % links.length;
      links[selected].setAttribute('aria-selected', 'true');
      links[selected].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && links[selected]) {
      e.preventDefault();
      location.href = links[selected].getAttribute('href');
    }
  });
})();
