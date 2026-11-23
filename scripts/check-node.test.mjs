import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nodeVersionProblem } from './check-node.mjs';

describe('支援的 Node 版本（NX-248）', () => {
  it('22.22 以上的 22.x 與 24.7 以上的 24.x 可以', () => {
    for (const v of ['v22.22.0', 'v22.23.4', 'v22.30.1', 'v24.7.0', 'v24.22.3']) expect(nodeVersionProblem(v)).toBeNull();
  });
  it('其他版本擋下，訊息說怎麼切換', () => {
    for (const v of ['v20.19.3', 'v22.16.0', 'v22.19.0', 'v22.21.1', 'v23.11.0', 'v24.6.0', 'v25.0.0']) {
      const problem = nodeVersionProblem(v);
      expect(problem).toContain(v);
      expect(problem).toContain('nvm install');
    }
  });
  it('package.json engines、.nvmrc 與檢查一致', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.engines.node).toBe('^22.22.0 || ^24.7.0');
    expect(pkg.scripts.preinstall).toBe('node scripts/check-node.mjs');
    const nvmrc = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
    expect(nodeVersionProblem(`v${nvmrc}`)).toBeNull();
  });
});
