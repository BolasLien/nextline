// npm run dev:cloudflare：同時跑 Worker（wrangler dev，http://localhost:8787）與前端 dev server（Vite，http://127.0.0.1:5173，有 HMR）。
// 開 http://localhost:5173；/api、/app-api、/mcp、/health、/legacy 由 Vite 轉給 8787（vite.app.config.ts）。
// 任何一個結束（或按 Ctrl+C），另一個也一起關掉。
import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev:worker'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev:app'], { stdio: 'inherit' }),
];

let exiting = false;
function stopAll(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => { stopAll(code ?? 0); });
process.on('SIGINT', () => { stopAll(0); });
process.on('SIGTERM', () => { stopAll(0); });
