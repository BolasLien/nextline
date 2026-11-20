// 「要你決定」（NX-239）：agent 在 comment 裡問 Bolas 要選哪個時固定寫成
//   要你決定：〈一句問題〉
//   1. 〈選項〉——〈會怎樣〉
//   2. …
// 待驗收的票頂端「等你回覆」把問題與選項照原文列出來（純文字，不做按鈕），回覆由 Bolas 自己寫。
// 只認「要你決定：」那一行後面緊接的編號行，至少兩個選項；格式不對就當沒有，頂端照常顯示下一步。
import type { Comment } from '../api/types';

export interface Decision {
  question: string;
  options: { n: number; text: string }[];
}

const PREFIX = '要你決定：';
const OPTION = /^\s*(\d+)\.\s+(\S.*)$/;

export function parseDecision(body: string): Decision | null {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().startsWith(PREFIX));
  if (at < 0) return null;
  const options: Decision['options'] = [];
  for (const line of lines.slice(at + 1)) {
    const m = OPTION.exec(line);
    if (m === null) break;
    options.push({ n: Number(m[1]), text: (m[2] ?? '').trim() });
  }
  if (options.length < 2) return null;
  return { question: (lines[at] ?? '').trim().slice(PREFIX.length).trim(), options };
}

// 只看最新的一則 comment：之後的 comment（例如 Bolas 已經回了）就不再顯示這個問題。
export function latestDecision(comments: readonly Comment[]): Decision | null {
  let latest: Comment | undefined;
  for (const c of comments) {
    if (latest === undefined || Date.parse(c.created_at) > Date.parse(latest.created_at) || (c.created_at === latest.created_at && c.id > latest.id)) latest = c;
  }
  return latest === undefined ? null : parseDecision(latest.body);
}
