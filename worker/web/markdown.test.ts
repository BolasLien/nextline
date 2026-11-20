import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown：防 XSS', () => {
  it('原文的 HTML 一律跳脫', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('javascript:、data: 連結不產生 href', () => {
    const html = renderMarkdown('[點我](javascript:alert(1)) [圖](data:text/html,x) [x](//evil.com)');
    expect(html).not.toMatch(/href="(javascript|data|\/\/)/i);
    expect(html).toContain('點我');
  });

  it('連結文字與網址裡的引號被跳脫，跳不出屬性', () => {
    const html = renderMarkdown('[a"onmouseover="x](https://e.com/"onclick="x)');
    expect(html).not.toMatch(/ on\w+="/);
    expect(html).toContain('href="https://e.com/&quot;onclick=&quot;x"');
  });

  it('程式碼裡的 HTML 也跳脫', () => {
    expect(renderMarkdown('`<b>`\n\n```\n<i>x</i>\n```')).toBe(
      '<p><code>&lt;b&gt;</code></p>\n<pre><code>&lt;i&gt;x&lt;/i&gt;</code></pre>',
    );
  });

  it('圖片只顯示成連結', () => {
    expect(renderMarkdown('![截圖](https://e.com/a.png)')).toBe(
      '<p><a href="https://e.com/a.png" rel="noopener noreferrer">圖片：截圖</a></p>',
    );
  });
});

describe('renderMarkdown：格式', () => {
  it('標題往下降一級、段落保留單一換行', () => {
    expect(renderMarkdown('# 目標\n第一行\n第二行')).toBe('<h2>目標</h2>\n<p>第一行<br>第二行</p>');
  });

  it('粗體、斜體、刪除線、行內程式碼；底線不當斜體', () => {
    expect(renderMarkdown('**粗** *斜* ~~刪~~ `a_b_c` snake_case_name')).toBe(
      '<p><strong>粗</strong> <em>斜</em> <del>刪</del> <code>a_b_c</code> snake_case_name</p>',
    );
  });

  it('網址自動變連結，不吃到句尾標點', () => {
    expect(renderMarkdown('見 https://linear.app/x。')).toBe(
      '<p>見 <a href="https://linear.app/x" rel="noopener noreferrer">https://linear.app/x</a>。</p>',
    );
  });

  it('巢狀清單與核取方塊', () => {
    const html = renderMarkdown('* 一\n  * 一之一\n* [x] 做完\n* [ ] 還沒\n\n1. 甲\n2. 乙');
    expect(html).toBe(
      '<ul><li>一<ul><li>一之一</li></ul></li><li><span class="task done">☑</span> 做完</li><li><span class="task">☐</span> 還沒</li></ul>\n<ol><li>甲</li><li>乙</li></ol>',
    );
  });

  it('表格包一層可以橫向捲動的容器', () => {
    const html = renderMarkdown('| 指令 | 用途 |\n| --- | :-: |\n| `npm test` | 測試 |');
    expect(html).toBe(
      '<div class="table-wrap"><table><thead><tr><th>指令</th><th class="align-center">用途</th></tr></thead><tbody><tr><td><code>npm test</code></td><td class="align-center">測試</td></tr></tbody></table></div>',
    );
  });

  it('引言與分隔線', () => {
    expect(renderMarkdown('> 引用\n\n---')).toBe('<blockquote><p>引用</p></blockquote>\n<hr>');
  });
});
