// 取最新的一則 comment（依 created_at、同時間比 id），給待驗收頂端「等你回覆」顯示完整上下文。
import type { Comment } from '../api/types';

export function latestComment(comments: readonly Comment[]): Comment | null {
  let latest: Comment | null = null;
  let latestTime = -Infinity;
  for (const c of comments) {
    const t = Date.parse(c.created_at);
    if (latest === null || t > latestTime || (t === latestTime && c.id > latest.id)) {
      latest = c;
      latestTime = t;
    }
  }
  return latest;
}
