// 票描述、comment、Project 說明的 Markdown → HTML。
// 防 XSS 的做法：原文的 HTML 一律跳脫成文字（不支援內嵌 HTML），只由這裡產生固定的標籤；
// 連結只接受 http(s)、mailto 與站內路徑，圖片只顯示成連結（CSP 也不允許外部圖片）。
// 支援：標題、段落（單一換行保留）、清單（可巢狀、核取方塊）、引言、程式碼區塊、表格、分隔線、
// 行內程式碼、粗體、斜體、刪除線、連結、網址。

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:|mailto:)/i.test(url) || /^\/(?!\/)/.test(url) || url.startsWith('#')) return url;
  return null;
}

// ---- 行內 ----

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"，。、；：！？」）])/g;

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w])/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*(?![\w*])/g, '<em>$1</em>')
    .replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, '<del>$1</del>');
}

function link(href: string, label: string): string {
  const safe = safeHref(href);
  if (safe === null) return label;
  return `<a href="${escapeHtml(safe)}" rel="noopener noreferrer">${label}</a>`;
}

export function renderInline(src: string): string {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(INLINE)) {
    out += emphasis(escapeHtml(src.slice(last, m.index)));
    const [whole, , code, bang, label, href, angle, bare] = m;
    if (code !== undefined) {
      out += `<code>${escapeHtml(code.replace(/^ (.*) $/s, '$1'))}</code>`;
    } else if (label !== undefined && href !== undefined) {
      const text = label === '' ? escapeHtml(href) : emphasis(escapeHtml(label));
      out += link(href, bang === '!' ? `圖片：${text}` : text);
    } else {
      const url = angle ?? bare ?? whole;
      out += link(url, escapeHtml(url));
    }
    last = m.index + whole.length;
  }
  return out + emphasis(escapeHtml(src.slice(last)));
}

// ---- 區塊 ----

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  return (/^\s*/.exec(line.replace(/\t/g, '    '))?.[0] ?? '').length;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function isTableStart(lines: string[], i: number): boolean {
  const line = lines[i] ?? '';
  const next = lines[i + 1];
  return line.includes('|') && next !== undefined && next.includes('-') && TABLE_SEP.test(next);
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? '';
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || isTableStart(lines, i);
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderTable(header: string, sep: string, rows: string[]): string {
  const aligns = splitRow(sep).map((c) =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null,
  );
  const cell = (tag: string, text: string, idx: number) => {
    const align = aligns[idx];
    // 用 class 不用 style 屬性：CSP 不允許行內 style。
    return `<${tag}${align ? ` class="align-${align}"` : ''}>${renderInline(text)}</${tag}>`;
  };
  const head = splitRow(header);
  const body = rows.map((r) => {
    const cells = splitRow(r);
    return `<tr>${head.map((_, idx) => cell('td', cells[idx] ?? '', idx)).join('')}</tr>`;
  });
  return `<div class="table-wrap"><table><thead><tr>${head.map((h, idx) => cell('th', h, idx)).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
}

interface ListItem {
  first: string;
  rest: string[];
}

function renderList(lines: string[], start: number): [string, number] {
  const firstMatch = LIST_ITEM.exec(lines[start] ?? '');
  const base = indentOf(lines[start] ?? '');
  const ordered = /\d/.test(firstMatch?.[2] ?? '');
  const startNumber = ordered ? parseInt(firstMatch?.[2] ?? '1', 10) : 1;
  const items: ListItem[] = [];
  let contentIndent = base + 2;
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      // 空行後面若還是同一份清單（下一項或縮排的內容）就繼續，否則清單結束。
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      const next = lines[j];
      if (next === undefined) break;
      const nextIndent = indentOf(next);
      if (nextIndent > base || (LIST_ITEM.test(next) && nextIndent === base)) {
        items.at(-1)?.rest.push('');
        i++;
        continue;
      }
      break;
    }
    const ind = indentOf(line);
    const m = LIST_ITEM.exec(line);
    if (ind < base) break;
    if (m !== null && ind === base) {
      // 項目符號從 * 換成 1.（或反過來）就是另一份清單。
      if (/\d/.test(m[2] ?? '') !== ordered) break;
      items.push({ first: m[3] ?? '', rest: [] });
      contentIndent = ind + (m[2]?.length ?? 1) + 1;
    } else if (ind > base) {
      items.at(-1)?.rest.push(line.replace(/\t/g, '    ').slice(Math.min(ind, contentIndent)));
    } else if (!startsBlock(lines, i)) {
      // 沒縮排的接續行：當成同一項的文字。
      const last = items.at(-1);
      if (last !== undefined) last.first += `\n${line.trim()}`;
    } else {
      break;
    }
    i++;
  }
  const html = items.map(({ first, rest }) => {
    const task = /^\[([ xX])\]\s+(.*)$/s.exec(first);
    const text = task === null ? first : (task[2] ?? '');
    const box = task === null ? '' : task[1] === ' ' ? '<span class="task">☐</span> ' : '<span class="task done">☑</span> ';
    const inner = text.split('\n').map(renderInline).join('<br>');
    return `<li>${box}${inner}${rest.some((r) => !isBlank(r)) ? renderBlocks(rest) : ''}</li>`;
  });
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNumber !== 1 ? ` start="${String(startNumber)}"` : '';
  return [`<${tag}${startAttr}>${html.join('')}</${tag}>`, i];
}

function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence?.[1] !== undefined) {
      const marker = fence[1];
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker)) {
        code.push(lines[i] ?? '');
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      // 頁面本身有 h1、h2，內容的標題往下降一級。
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${String(level)}>${renderInline(heading[2] ?? '')}</h${String(level)}>`);
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        quoted.push((lines[i] ?? '').replace(QUOTE, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = line;
      const sep = lines[i + 1] ?? '';
      const rows: string[] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && (lines[i] ?? '').includes('|')) {
        rows.push(lines[i] ?? '');
        i++;
      }
      out.push(renderTable(header, sep, rows));
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const [html, next] = renderList(lines, i);
      out.push(html);
      i = next;
      continue;
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

export function renderMarkdown(src: string): string {
  return renderBlocks(src.replace(/\r\n?/g, '\n').split('\n'));
}
