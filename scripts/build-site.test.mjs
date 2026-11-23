// 官網與文件站：建出來的每一頁連結都找得到、沒有內部用語、程式碼區塊有跳脫。
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSite, docOrder, renderCode } from './build-site.mjs';

let out;
const pages = new Map();

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'nextline-site-'));
  await buildSite(out);
  pages.set('index.html', await readFile(join(out, 'index.html'), 'utf8'));
  for (const f of await readdir(join(out, 'docs'))) pages.set(`docs/${f}`, await readFile(join(out, 'docs', f), 'utf8'));
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

describe('官網與文件站', () => {
  it('目錄裡的每一頁都有建出來', () => {
    for (const p of docOrder()) expect(pages.has(`docs/${p.slug}.html`), p.slug).toBe(true);
    expect(pages.size).toBe(docOrder().length + 1);
  });

  it('站內連結與錨點都找得到', async () => {
    const broken = [];
    for (const [file, html] of pages) {
      for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const link = m[1];
        if (/^(https?:|mailto:)/.test(link)) continue;
        const [path, hash] = link.split('#');
        const target = path === '' ? file : normalize(join(dirname(file), path));
        let targetHtml = pages.get(target);
        if (targetHtml === undefined) {
          try {
            await readFile(join(out, target));
            targetHtml = '';
          } catch {
            broken.push(`${file} → ${link}`);
            continue;
          }
        }
        if (hash !== undefined && hash !== '' && !targetHtml.includes(`id="${hash}"`)) broken.push(`${file} → ${link}（沒有這個錨點）`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('沒有內部用語或私人票號', () => {
    const hits = [];
    const banned = [/Bolas(?!Lien)/, /阿澈/, /搬家/, /BOL[-]\d/, /NX-\d{3,}/, /\.scratch\/nx/, /晨報/];
    for (const [file, html] of pages) {
      for (const re of banned) {
        const m = re.exec(html);
        if (m !== null) hits.push(`${file}: ${m[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('沒有漏轉的程式碼區塊', () => {
    for (const [file, html] of pages) expect(html.includes('```'), file).toBe(false);
  });
});

describe('renderCode', () => {
  it('跳脫內容、shell 註解上色', () => {
    const html = renderCode('```sh\ncurl -H "a" <x> && y # 註解\n```');
    expect(html).toContain('curl -H &quot;a&quot; &lt;x&gt; &amp;&amp; y <span class="c"># 註解</span>');
  });
});
