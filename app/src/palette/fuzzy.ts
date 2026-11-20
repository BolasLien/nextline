// 指令面板的模糊比對（中文、英文都適用）：分數越高越前面，比不到回 null。
// - 用空白分開的每個詞都要比得到（「nextline 看板」）。
// - 同一個詞：開頭就對到 > 在詞的開頭對到 > 中間對到 > 字依序出現但中間有隔開（「開票」對到「開一張票」）。
// - 字依序出現但隔太遠就不算，避免短字在長標題裡亂對。

export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const BOUNDARY = /[\s\-_/・：:（）()「」，,.。]/;

function tokenScore(text: string, token: string): number | null {
  const at = text.indexOf(token);
  if (at === 0) return 100;
  if (at > 0) {
    const prev = text[at - 1] ?? '';
    return BOUNDARY.test(prev) ? 90 : 80 - Math.min(at, 20) * 0.5;
  }
  // 依序出現（subsequence）：從第一個字開始找，記中間跳過幾個字
  const first = text.indexOf(token[0] ?? '');
  if (first === -1) return null;
  let pos = first;
  let gaps = 0;
  for (let k = 1; k < token.length; k++) {
    const next = text.indexOf(token[k] ?? '', pos + 1);
    if (next === -1) return null;
    gaps += next - pos - 1;
    pos = next;
  }
  if (gaps > Math.max(6, token.length * 2)) return null;
  return Math.max(1, 50 - gaps * 3 - Math.min(first, 20) * 0.5);
}

export function fuzzyScore(text: string, query: string): number | null {
  const q = normalize(query);
  if (q === '') return 0;
  const t = normalize(text);
  let total = 0;
  const tokens = q.split(' ');
  for (const token of tokens) {
    const s = tokenScore(t, token);
    if (s === null) return null;
    total += s;
  }
  return total / tokens.length;
}
