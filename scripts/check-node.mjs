import { pathToFileURL } from 'node:url';

// 支援的 Node 版本，`npm ci`（preinstall）與 `npm start`／`selfhost:*`（node/config.ts）共用這一份。
// 下限是 node:sqlite 能跑 Nextline 的版本（NX-248 實測）：22.19、24.6（含）以前的 node:sqlite 綁不了 ?1 這種編號參數
// （"column index out of range"），開票就 500；react-router 宣告要 22.22 以上。23 是短期版，25 以後還沒驗過。
// 改範圍時同步 package.json 的 engines。
export const SUPPORTED_NODE = '22.22.0 以上的 22.x，或 24.7.0 以上的 24.x';

export function nodeVersionProblem(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if ((major === 22 && minor >= 22) || (major === 24 && minor >= 7)) return null;
  return [
    `Nextline 需要 Node ${SUPPORTED_NODE}；目前是 ${version}。`,
    '用 nvm 切換：在 repo 裡執行 nvm install && nvm use（讀 .nvmrc），再重跑這個指令。',
    '沒有 nvm：到 https://nodejs.org/en/download 安裝 Node 24 LTS。',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = nodeVersionProblem(process.version);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
