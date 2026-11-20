import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Config } from './config';
import { checkVersions } from './database';

/** Always create a new directory: partial output is never reused or mistaken for a backup. */
export async function snapshot(config: Config, source: string, destination: string): Promise<void> {
  if (!isAbsolute(destination)) throw new Error('目的地必須是全新目錄的完整路徑。');
  if (existsSync(destination)) throw new Error('目的地已存在；為保留原資料，請使用全新目錄。');
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('找不到來源 SQLite 檔案。');
  const input = new DatabaseSync(source, { readOnly: true });
  try {
    input.exec('PRAGMA busy_timeout=5000');
    checkVersions(input, config);
    mkdirSync(destination, { mode: 0o700 });
    const output = join(destination, 'nextline.sqlite.partial');
    // backup() includes committed WAL content; copying only the main file does not.
    await backup(input, output);
    chmodSync(output, 0o600);
    const check = new DatabaseSync(output);
    try {
      if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || check.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('備份驗證失敗，請保留來源並換新目錄重試。');
      checkVersions(check, config);
      // Standalone snapshot, no WAL sidecars required to move this file.
      check.exec('PRAGMA journal_mode=DELETE');
    } finally { check.close(); }
    renameSync(output, join(destination, 'nextline.sqlite'));
  } finally { input.close(); }
}
