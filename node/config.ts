import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { ownerName } from '../worker/api/owner';
import { nodeVersionProblem } from '../scripts/check-node.mjs';

export interface Config {
  dataDir: string;
  clientDir: string;
  migrationsDir: string;
  host: string;
  port: number;
  origin: string;
  secure: boolean;
  trustedProxies: string[];
  // 「人」的名字（worker/api/owner.ts，NX-244）；NEXTLINE_OWNER_NAME 沒設定時用預設值。
  ownerName: string;
}

export function configFromEnv(env = process.env): Config {
  const host = env.NEXTLINE_HOST ?? '127.0.0.1';
  const port = Number(env.NEXTLINE_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NEXTLINE_PORT 必須介於 1–65535。');
  if (isIP(host) === 0) throw new Error('NEXTLINE_HOST 必須是明確的 IP 位址。');
  const originUrl = new URL(env.NEXTLINE_PUBLIC_URL ?? `http://${host === '::1' ? '[::1]' : host}:${String(port)}`);
  if (originUrl.pathname !== '/' || originUrl.search || originUrl.hash || originUrl.username || originUrl.password) throw new Error('NEXTLINE_PUBLIC_URL 只能包含協定、主機與連接埠。');
  const trustedProxies = (env.NEXTLINE_TRUSTED_PROXIES ?? '').split(',').filter(Boolean);
  if (trustedProxies.some((ip) => isIP(ip) === 0)) throw new Error('代理只接受明確 IP，不接受萬用字元或網段。');
  const secure = originUrl.protocol === 'https:';
  const loopback = host === '127.0.0.1' || host === '::1';
  if (!secure && (!loopback || originUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(originUrl.hostname) || trustedProxies.length > 0)) throw new Error('對外服務必須設定 HTTPS 公開網址與可信任代理 IP。');
  if (secure && trustedProxies.length === 0) throw new Error('HTTPS 模式必須設定 NEXTLINE_TRUSTED_PROXIES。');
  return {
    dataDir: resolve(env.NEXTLINE_DATA_DIR ?? resolve(homedir(), '.local/share/nextline')),
    clientDir: resolve('dist/client'), migrationsDir: resolve('migrations'),
    host, port, origin: originUrl.origin, secure, trustedProxies,
    ownerName: ownerName({ OWNER_NAME: env.NEXTLINE_OWNER_NAME }),
  };
}

export function requireNodeVersion(): void {
  const problem = nodeVersionProblem(process.version);
  if (problem) throw new Error(problem);
}
