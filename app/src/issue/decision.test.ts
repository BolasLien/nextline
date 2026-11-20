import { describe, expect, it } from 'vitest';
import type { Comment } from '../api/types';
import { latestDecision, parseDecision } from './decision';

const body = [
  '兩種顯示方式都做好示意了。',
  '',
  '要你決定：卡片上的到期日要怎麼顯示？',
  '1. 只在 3 天內到期時顯示——卡片比較乾淨（推薦）',
  '2. 有到期日就一直顯示——一眼看到全部日期',
  '',
  '下一步：Bolas 選 1 或 2',
].join('\n');

function cmt(id: number, created_at: string, text: string): Comment {
  return { id, issue_number: 7, author: 'nextline agent', body: text, linear_id: null, created_at, updated_at: created_at };
}

describe('要你決定', () => {
  it('抓出問題與緊接的編號選項，選項保留原文', () => {
    expect(parseDecision(body)).toEqual({
      question: '卡片上的到期日要怎麼顯示？',
      options: [
        { n: 1, text: '只在 3 天內到期時顯示——卡片比較乾淨（推薦）' },
        { n: 2, text: '有到期日就一直顯示——一眼看到全部日期' },
      ],
    });
  });

  it('沒有「要你決定：」、只有一個選項、或選項沒緊接在後面，都當沒有', () => {
    expect(parseDecision('做好了\n下一步：Bolas 驗收')).toBeNull();
    expect(parseDecision('要你決定：要不要上線？\n1. 要')).toBeNull();
    expect(parseDecision('要你決定：要不要上線？\n\n1. 要\n2. 不要')).toBeNull();
  });

  it('選項遇到不是編號的行就停', () => {
    expect(parseDecision('要你決定：哪個？\n1. A\n2. B\n下一步：Bolas 選\n3. C')?.options.map((o) => o.n)).toEqual([1, 2]);
  });

  it('只看最新的一則 comment', () => {
    const asked = cmt(1, '2026-11-20T01:00:00.000Z', body);
    const replied = cmt(2, '2026-11-20T02:00:00.000Z', '選 1');
    expect(latestDecision([asked])?.options).toHaveLength(2);
    expect(latestDecision([replied, asked])).toBeNull();
    expect(latestDecision([])).toBeNull();
  });
});
