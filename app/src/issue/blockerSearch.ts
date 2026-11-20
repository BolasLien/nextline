// blocked by 的 combobox：用票號（NX-12、12、BOL-150）或標題找票。
import type { Issue } from '../api/types';

export const MAX_RESULTS = 8;

export function searchIssues(issues: readonly Issue[], query: string, exclude: ReadonlySet<number>): Issue[] {
  const q = query.trim().toLowerCase();
  const pool = issues.filter((i) => !exclude.has(i.number));
  if (q === '') return pool.slice(0, MAX_RESULTS);
  const num = /^(?:nx-?)?(\d+)$/.exec(q)?.[1];
  const scored = pool.flatMap((i) => {
    if (num !== undefined && String(i.number) === num) return [{ i, score: 0 }];
    if (i.legacy_identifier !== null && i.legacy_identifier.toLowerCase() === q) return [{ i, score: 0 }];
    if (num !== undefined && String(i.number).startsWith(num)) return [{ i, score: 1 }];
    if (i.identifier.toLowerCase().startsWith(q) || (i.legacy_identifier?.toLowerCase().startsWith(q) ?? false)) return [{ i, score: 1 }];
    const at = i.title.toLowerCase().indexOf(q);
    return at === -1 ? [] : [{ i, score: 2 + at / 1000 }];
  });
  return scored
    .sort((a, b) => a.score - b.score || b.i.number - a.i.number)
    .slice(0, MAX_RESULTS)
    .map((s) => s.i);
}
