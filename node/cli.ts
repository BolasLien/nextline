import { configFromEnv, requireNodeVersion } from './config';
import { openDatabase } from './database';
import { LocalAuth } from './auth';
import { snapshot } from './backup';
import { join } from 'node:path';

async function readPassword(): Promise<string> {
  if (process.argv.includes('--password-stdin')) {
    let value = '';
    for await (const chunk of process.stdin) {
      value += String(chunk);
      if (value.length > 1024) throw new Error('密碼輸入太長。');
    }
    return value.replace(/\r?\n$/, '');
  }
  if (!process.stdin.isTTY) throw new Error('請在終端機輸入密碼，或使用 --password-stdin。');
  process.stderr.write('設定登入密碼（12–256 字元，輸入不顯示）：');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stderr.write('\n'); };
    const onData = (text: string) => {
      for (const character of text) {
        if (character === '\u0003') { done(); reject(new Error('已取消。')); return; }
        if (character === '\r' || character === '\n') { done(); resolve(value); return; }
        if (character === '\u007f') value = Array.from(new Intl.Segmenter().segment(value), (s) => s.segment).slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  requireNodeVersion();
  process.umask(0o077);
  const command = process.argv[2];
  if (!['init', 'reset-password', 'rotate-token', 'backup', 'restore'].includes(command ?? '')) throw new Error('用法：init | reset-password | rotate-token | backup <全新目錄> | restore <備份目錄> <全新資料目錄>');
  const config = configFromEnv();
  if (command === 'backup' || command === 'restore') {
    const source = command === 'backup' ? config.dataDir : process.argv[3];
    const destination = process.argv[command === 'backup' ? 3 : 4];
    if (!source || !destination) throw new Error('請指定來源及全新目的地，詳見 docs/self-host.md。');
    await snapshot(config, join(source, 'nextline.sqlite'), destination);
    console.log(command === 'backup' ? '備份完成，完整性與關聯驗證通過。' : '已還原到新目錄，原資料未更動。停止服務後設定 NEXTLINE_DATA_DIR，再初始化並啟動。');
  } else {
    const db = openDatabase(config, command === 'init');
    try {
      const auth = new LocalAuth(db);
      if (command === 'init') {
        if (auth.configured()) console.log('已初始化，既有密碼、token 與資料保留。');
        else { await auth.initialize(await readPassword()); console.log('初始化完成。請執行 npm run selfhost:token 產生 agent token，再執行 npm start。'); }
      } else {
        if (!auth.configured()) throw new Error('請先執行 selfhost:init。');
        if (command === 'rotate-token') process.stdout.write(auth.rotateToken() + '\n');
        else { await auth.resetPassword(await readPassword()); console.log('密碼已重設，所有舊登入已失效。'); }
      }
    } finally { db.close(); }
  }
} catch (error) { console.error(error instanceof Error ? error.message : '操作失敗。'); process.exitCode = 1; }
