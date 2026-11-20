// /api 共用的回應格式與輸入檢查。錯誤一律回 JSON：{ "error": "..." }。

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, { status, headers });
}

export function errorResponse(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

export type Body = Record<string, unknown>;

export async function readBody(request: Request): Promise<Body> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, '內容必須是 JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, '內容必須是 JSON 物件');
  }
  return body as Body;
}

export function has(body: Body, key: string): boolean {
  return Object.hasOwn(body, key) && body[key] !== undefined;
}

export function str(body: Body, key: string): string | undefined {
  if (!has(body, key)) return undefined;
  const v = body[key];
  if (typeof v !== 'string') throw new HttpError(400, `${key} 必須是字串`);
  return v;
}

export function bool(body: Body, key: string): boolean | undefined {
  if (!has(body, key)) return undefined;
  const v = body[key];
  if (typeof v !== 'boolean') throw new HttpError(400, `${key} 必須是 true 或 false`);
  return v;
}

export function requiredStr(body: Body, key: string): string {
  const v = str(body, key)?.trim();
  if (v === undefined || v === '') throw new HttpError(400, `缺少 ${key}`);
  return v;
}

export function nullableStr(body: Body, key: string): string | null | undefined {
  if (has(body, key) && body[key] === null) return null;
  return str(body, key);
}

export function nullableInt(body: Body, key: string): number | null | undefined {
  if (!has(body, key)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
    throw new HttpError(400, `${key} 必須是正整數或 null`);
  }
  return v;
}

export function requiredInt(body: Body, key: string): number {
  const v = nullableInt(body, key);
  if (v === undefined || v === null) throw new HttpError(400, `缺少 ${key}`);
  return v;
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[]): T | undefined {
  const v = str(body, key);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new HttpError(400, `${key} 必須是 ${allowed.join('、')} 其中之一`);
  }
  return v as T;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// 時間一律存成 toISOString() 的 UTC 格式，字串比較才會等於時間先後。
export function toTimestamp(value: string, key: string): string {
  const d = new Date(value);
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(d.getTime())) {
    throw new HttpError(400, `${key} 必須是 ISO 8601 時間（例如 2026-11-02T08:29:53.024Z）`);
  }
  return d.toISOString();
}

export function timestamp(body: Body, key: string): string | undefined {
  const v = str(body, key);
  return v === undefined ? undefined : toTimestamp(v, key);
}

export function requiredTimestamp(body: Body, key: string): string {
  const v = timestamp(body, key);
  if (v === undefined) throw new HttpError(400, `缺少 ${key}`);
  return v;
}

export function nullableTimestamp(body: Body, key: string): string | null | undefined {
  if (has(body, key) && body[key] === null) return null;
  return timestamp(body, key);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function nullableDate(body: Body, key: string): string | null | undefined {
  const v = nullableStr(body, key);
  if (typeof v === 'string' && (!DATE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()))) {
    throw new HttpError(400, `${key} 必須是 YYYY-MM-DD 或 null`);
  }
  return v;
}

export function now(): string {
  return new Date().toISOString();
}

// 網址上的 id（Project、Sprint、comment）：正整數。
export function parseId(segment: string, what: string): number {
  if (!/^\d+$/.test(segment)) throw new HttpError(404, `找不到${what} ${segment}`);
  const n = Number(segment);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, `找不到${what} ${segment}`);
  return n;
}

export function queryInt(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${key} 必須是 ${String(min)}～${String(max)} 的整數`);
  }
  return n;
}

// 事先檢查漏掉的情況（例如同時寫入）由資料庫約束擋下，轉成看得懂的錯誤。/api 與 /mcp 共用。
export function toHttpError(e: unknown): HttpError | null {
  if (e instanceof HttpError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes('UNIQUE constraint failed')) return new HttpError(409, '資料重複');
  if (message.includes('FOREIGN KEY constraint failed')) return new HttpError(400, '關聯的資料不存在');
  if (message.includes('CHECK constraint failed')) return new HttpError(400, '資料不符合限制');
  return null;
}
