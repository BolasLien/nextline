import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { configFromEnv, requireNodeVersion } from './config';
import { openDatabase } from './database';
import { createNodeServer } from './server';

try {
  requireNodeVersion();
  process.umask(0o077);
  const config = configFromEnv();
  if (!existsSync(join(config.clientDir, 'index.html'))) throw new Error('找不到網頁建置檔。請先執行 npm run build。');
  const db = openDatabase(config);
  const server = createNodeServer(config, db);
  server.on('error', (error) => { console.error(error.message); db.close(); process.exitCode = 1; });
  server.listen(config.port, config.host, () => { console.log(`Nextline：${config.origin}`); });
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.close(() => { db.close(); });
    setTimeout(() => { server.closeAllConnections(); }, 5000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) { console.error(error instanceof Error ? error.message : '啟動失敗。'); process.exitCode = 1; }
