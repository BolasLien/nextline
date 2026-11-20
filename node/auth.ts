import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const SESSION_SECONDS = 12 * 60 * 60;
export const COOKIE = 'nextline_session';
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}

export async function passwordHash(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) throw new Error('密碼請使用 12–256 個字元。');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export class LocalAuth {
  constructor(private readonly db: DatabaseSync) {}

  configured(): boolean { return this.db.prepare('SELECT id FROM local_owner WHERE id=1').get() !== undefined; }

  async initialize(password: string): Promise<boolean> {
    if (this.configured()) return false;
    const hash = await passwordHash(password);
    return this.db.prepare('INSERT OR IGNORE INTO local_owner (id,password_hash) VALUES (1,?)').run(hash).changes > 0;
  }

  async resetPassword(password: string): Promise<void> {
    const hash = await passwordHash(password);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE local_owner SET password_hash=? WHERE id=1').run(hash);
      this.db.exec('DELETE FROM local_sessions; DELETE FROM local_login_limit; COMMIT;');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  rotateToken(): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('UPDATE local_owner SET token_hash=? WHERE id=1').run(digest(token));
    return token;
  }

  tokenHash(): string { return String(this.db.prepare('SELECT token_hash FROM local_owner WHERE id=1').get()?.token_hash ?? ''); }

  async login(password: unknown, now = Date.now()): Promise<{ status: number; token?: string }> {
    // Deployment-wide limit: no spoofable forwarded address, bounded storage, survives restart.
    const limit = this.db.prepare('SELECT attempts,reset_at FROM local_login_limit WHERE id=1').get();
    const active = Number(limit?.reset_at ?? 0) > now;
    if (active && Number(limit?.attempts) >= 5) return { status: 429 };
    this.db.prepare('INSERT INTO local_login_limit VALUES (1,1,?) ON CONFLICT(id) DO UPDATE SET attempts=?,reset_at=?').run(
      now + 60_000, active ? Number(limit?.attempts) + 1 : 1, active ? Number(limit?.reset_at) : now + 60_000,
    );
    if (typeof password !== 'string' || password.length > 256) return { status: 401 };
    const hash = String(this.db.prepare('SELECT password_hash FROM local_owner WHERE id=1').get()?.password_hash ?? '');
    const [, , , , salt, key] = hash.split('$');
    if (!salt || !key) return { status: 503 };
    const derived = await derive(password, salt);
    // A password reset while scrypt runs must not mint a session for the old password.
    if (hash !== this.db.prepare('SELECT password_hash FROM local_owner WHERE id=1').get()?.password_hash || !timingSafeEqual(derived, Buffer.from(key, 'hex'))) return { status: 401 };
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(now);
    this.db.prepare('INSERT INTO local_sessions VALUES (?,?)').run(digest(token), now + SESSION_SECONDS * 1000);
    return { status: 200, token };
  }

  private sessionToken(request: Request): string {
    return request.headers.get('cookie')?.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
  }

  authenticated(request: Request, now = Date.now()): boolean {
    const token = this.sessionToken(request);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const session = this.db.prepare('SELECT expires_at FROM local_sessions WHERE hash=?').get(digest(token));
    return Number(session?.expires_at ?? 0) > now;
  }

  logout(request: Request): void { this.db.prepare('DELETE FROM local_sessions WHERE hash=?').run(digest(this.sessionToken(request))); }
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(token ? SESSION_SECONDS : 0)}${secure ? '; Secure' : ''}`;
}
