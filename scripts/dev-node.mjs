import { spawn, spawnSync } from 'node:child_process';
import { context } from 'esbuild';
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const watcher = await context({ entryPoints: ['node/main.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', outfile: 'dist/server/main.mjs' });
await watcher.watch();
const env = { ...process.env, NEXTLINE_HOST: '127.0.0.1', NEXTLINE_PORT: '3000', NEXTLINE_PUBLIC_URL: 'http://127.0.0.1:5173', NEXTLINE_TRUSTED_PROXIES: '', NEXTLINE_NODE_DEV: '1' };
const children = [spawn(process.execPath, ['--watch', 'dist/server/main.mjs'], { stdio: 'inherit', env }), spawn('npm', ['run', 'dev:app'], { stdio: 'inherit', env })];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  void watcher.dispose();
  process.exitCode = code;
}
for (const child of children) child.on('exit', (code) => { stop(code ?? 0); });
process.on('SIGINT', () => { stop(0); });
process.on('SIGTERM', () => { stop(0); });
