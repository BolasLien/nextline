// 官網與文件站：把 site/ 的頁面片段套上共用版面，輸出成純靜態檔到 dist/site/（不需要伺服器，file:// 也能開）。
//   node scripts/build-site.mjs [輸出目錄]
// 頁面片段開頭用 HTML 註解寫 title／crumb／intro；內文的 ```lang … ``` 區塊會轉成程式碼卡片（內容自動跳脫）。
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'site');
const GITHUB = 'https://github.com/BolasLien/nextline';

// 文件目錄（側欄、上一頁／下一頁的順序都照這裡）。
export const NAV = [
  {
    title: '入門',
    pages: [
      { slug: 'index', title: 'Nextline 是什麼' },
      { slug: 'install', title: '安裝與第一次登入' },
      { slug: 'first-issue', title: '讓 agent 開第一張票' },
    ],
  },
  {
    title: '操作指南',
    pages: [
      { slug: 'claude-code', title: '連上 Claude Code' },
      { slug: 'codex', title: '連上 Codex' },
      { slug: 'server', title: '架在伺服器上（HTTPS）' },
      { slug: 'cloudflare', title: '部署到 Cloudflare' },
      { slug: 'backup', title: '備份、還原與更新' },
      { slug: 'credentials', title: '忘記密碼、換 token' },
    ],
  },
  {
    title: '參考',
    pages: [
      { slug: 'api', title: '認證與錯誤格式' },
      {
        slug: 'api-issues',
        title: 'REST API',
        children: [
          { slug: 'api-issues', title: '票' },
          { slug: 'api-comments', title: 'comment' },
          { slug: 'api-projects', title: 'Project' },
          { slug: 'api-events', title: '變更紀錄與還原' },
          { slug: 'api-blockers', title: 'blocked by' },
          { slug: 'api-sprints', title: 'Sprint' },
        ],
      },
      { slug: 'mcp', title: 'MCP 工具' },
      { slug: 'mcp-linear', title: '和 Linear MCP 的差異' },
    ],
  },
  {
    title: '說明',
    pages: [
      { slug: 'single-user', title: '為什麼只給一個人用' },
      { slug: 'architecture', title: '一份核心、兩種跑法' },
    ],
  },
];

// 照閱讀順序攤平（REST API 那一層本身不是一頁，用它的子頁）。
export function docOrder() {
  return NAV.flatMap((s) => s.pages.flatMap((p) => p.children ?? [p]));
}

export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 開頭的 <!-- key: value --> 區塊。
export function parsePage(source) {
  const m = /^<!--\n([\s\S]*?)\n-->\n/.exec(source);
  if (m === null) throw new Error('頁面開頭要有 <!-- title: … --> 區塊');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: source.slice(m[0].length) };
}

// ```lang … ``` → 程式碼卡片。sh 的 # 註解、json 的 key 上色，其餘原樣（跳脫後）輸出。
export function renderCode(body) {
  return body.replace(/^```(\w*)\n([\s\S]*?)\n```$/gm, (_all, lang, code) => {
    const lines = escapeHtml(code)
      .split('\n')
      .map((line) => {
        if (lang === 'sh' || lang === 'toml' || lang === 'caddyfile') {
          const hash = line.search(/(^|\s)#(?!!)/);
          if (hash >= 0) {
            const at = line[hash] === '#' ? hash : hash + 1;
            return `${line.slice(0, at)}<span class="c">${line.slice(at)}</span>`;
          }
        }
        if (lang === 'json') return line.replace(/^(\s*)(&quot;[^&]*&quot;)(:)/, '$1<span class="k">$2</span>$3');
        return line;
      })
      .join('\n');
    return `<div class="code-card"><button class="copy" type="button">複製</button><pre class="code"><code>${lines}</code></pre></div>`;
  });
}

// 三欄以上的表格：每個儲存格帶上欄名（data-label），手機直排時顯示在值前面。
export function labelTables(html) {
  return html.replace(/<table class="ref[^"]*">[\s\S]*?<\/table>/g, (table) => {
    const labels = [...table.matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    if (labels.length < 3) return table;
    return table.replace(/<tr>([\s\S]*?)<\/tr>/g, (row, cells) => {
      let i = 0;
      return `<tr>${cells.replace(/<td>/g, () => `<td data-label="${escapeHtml(labels[i++] ?? '')}">`)}</tr>`;
    });
  });
}

function headings(body) {
  return [...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map((m) => ({ id: m[1], text: m[2].replace(/<[^>]+>/g, '') }));
}

function plainText(html) {
  return html
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const LOGO =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1E3A5F"/><rect x="6" y="9" width="13" height="5" rx="1.5" fill="#FFFFFF"/><rect x="12" y="18" width="14" height="5" rx="1.5" fill="#2DD4BF"/></svg>';
const SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

function head({ title, description, base }) {
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}assets/site.css">
<script src="${base}assets/theme-init.js"></script>
</head>`;
}

function topBar({ base, wide, current }) {
  return `<header class="top">
  <div class="wrap"${wide ? ' style="max-width:1280px"' : ''}>
    <a class="brand" href="${base}index.html" aria-label="Nextline 首頁">${LOGO}Nextline</a>
    <nav class="nav" aria-label="主要">
      <a href="${base}docs/index.html"${current === 'docs' ? ' aria-current="page"' : ''}>文件</a>
      <a class="hide-sm" href="${base}docs/api.html"${current === 'api' ? ' aria-current="page"' : ''}>API</a>
      <a href="${GITHUB}">GitHub</a>
      <button class="theme-btn" type="button" aria-label="切換深淺色" data-theme-toggle>${SUN}</button>
    </nav>
  </div>
</header>`;
}

function footer(base) {
  return `<footer class="foot">
  <div class="wrap">
    <span>Nextline · Apache-2.0</span>
    <nav aria-label="頁尾">
      <a href="${base}docs/index.html">文件</a>
      <a href="${GITHUB}">GitHub</a>
      <a href="${GITHUB}/issues">回報問題</a>
    </nav>
  </div>
</footer>
<script src="${base}assets/search-index.js"></script>
<script src="${base}assets/site.js"></script>
</body>
</html>
`;
}

function sidebar(slug) {
  const link = (p) => `<a href="${p.slug}.html"${p.slug === slug ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a>`;
  const groups = NAV.map((s) => {
    const items = s.pages
      .map((p) => {
        if (p.children === undefined) return `<li>${link(p)}</li>`;
        const kids = p.children.map((c) => `<li>${link(c)}</li>`).join('');
        return `<li><span class="side-group">${escapeHtml(p.title)}</span><ul>${kids}</ul></li>`;
      })
      .join('\n      ');
    return `<h4>${escapeHtml(s.title)}</h4>\n    <ul>\n      ${items}\n    </ul>`;
  }).join('\n    ');
  return `<aside class="side" id="side" aria-label="文件目錄">
    <button class="search" type="button" data-search-open><span>搜尋文件</span><kbd>⌘K</kbd></button>
    ${groups}
  </aside>`;
}

function searchDialog(base) {
  return `<div class="search-panel" id="search-panel" hidden data-base="${base}">
  <div class="search-box" role="dialog" aria-modal="true" aria-label="搜尋文件">
    <input type="search" id="search-input" placeholder="搜尋文件，例如 token、封存、MCP" autocomplete="off" aria-controls="search-results">
    <ul id="search-results" class="search-results" role="listbox"></ul>
  </div>
</div>`;
}

function docPage(page, order) {
  const { meta, body } = page;
  const i = order.findIndex((p) => p.slug === page.slug);
  const prev = order[i - 1];
  const next = order[i + 1];
  const html = labelTables(renderCode(body));
  const toc = headings(body);
  const crumb = meta.crumb ?? '';
  const pager = `<nav class="pager" aria-label="上一頁下一頁">
      ${prev === undefined ? '<span></span>' : `<a href="${prev.slug}.html"><small>上一頁</small>${escapeHtml(prev.title)}</a>`}
      ${next === undefined ? '<span></span>' : `<a class="next" href="${next.slug}.html"><small>下一頁</small>${escapeHtml(next.title)}</a>`}
    </nav>`;
  const tocHtml =
    toc.length === 0
      ? '<nav class="toc" aria-label="本頁目錄"></nav>'
      : `<nav class="toc" aria-label="本頁目錄">
    <h4>本頁</h4>
    ${toc.map((h) => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`).join('\n    ')}
  </nav>`;
  const current = page.slug.startsWith('api') ? 'api' : 'docs';
  return `${head({ title: `${meta.title} — Nextline 文件`, description: meta.intro ?? meta.title, base: '../' })}
<body>
${topBar({ base: '../', wide: true, current })}
<button class="menu-btn" type="button" aria-expanded="false" aria-controls="side" data-menu>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  ${escapeHtml(crumb === '' ? meta.title : `${crumb} › ${meta.title}`)}
</button>
<div class="docs">
  ${sidebar(page.slug)}
  <article class="doc">
    ${crumb === '' ? '' : `<div class="crumb">${escapeHtml(crumb)}</div>`}
    <h1>${escapeHtml(meta.title)}</h1>
    ${meta.intro === undefined ? '' : `<p class="intro">${escapeHtml(meta.intro)}</p>`}
${html}
    ${pager}
  </article>
  ${tocHtml}
</div>
${searchDialog('../')}
${footer('../')}`;
}

function homePage(page) {
  return `${head({ title: page.meta.title, description: page.meta.intro, base: '' })}
<body>
${topBar({ base: '', wide: false, current: '' })}
${renderCode(page.body)}
${searchDialog('')}
${footer('')}`;
}

export async function buildSite(outDir = join(ROOT, 'dist/site')) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'docs'), { recursive: true });
  await mkdir(join(outDir, 'assets'), { recursive: true });

  const order = docOrder();
  const index = [];
  for (const p of order) {
    const page = { slug: p.slug, ...parsePage(await readFile(join(SRC, 'docs', `${p.slug}.html`), 'utf8')) };
    if (page.meta.title !== p.title) throw new Error(`${p.slug}.html 的 title「${page.meta.title}」跟目錄的「${p.title}」不一樣`);
    await writeFile(join(outDir, 'docs', `${p.slug}.html`), docPage(page, order));
    index.push({
      url: `docs/${p.slug}.html`,
      title: p.title,
      crumb: page.meta.crumb ?? '',
      headings: headings(page.body),
      text: plainText(page.body).slice(0, 4000),
    });
  }
  const home = parsePage(await readFile(join(SRC, 'index.html'), 'utf8'));
  await writeFile(join(outDir, 'index.html'), homePage(home));

  await writeFile(join(outDir, 'assets', 'search-index.js'), `window.NEXTLINE_SEARCH = ${JSON.stringify(index)};\n`);
  for (const f of ['site.css', 'site.js', 'theme-init.js']) await copyFile(join(SRC, 'assets', f), join(outDir, 'assets', f));
  await copyFile(join(ROOT, 'app/public/favicon.svg'), join(outDir, 'assets', 'favicon.svg'));
  await copyFile(join(ROOT, 'docs/images/board.jpg'), join(outDir, 'assets', 'board.jpg'));
  return { outDir, pages: order.length + 1 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
  const { outDir, pages } = await buildSite(out);
  console.log(`官網與文件站：${String(pages)} 頁 → ${outDir}`);
}
