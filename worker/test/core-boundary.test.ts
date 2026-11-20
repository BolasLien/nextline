import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('portable router dependency graph contains no environment imports or runtime-specific types', () => {
  const seen = new Set<string>();
  const forbidden = new Set(['D1Database', 'D1PreparedStatement', 'D1Result', 'Fetcher', 'ExportedHandler', 'IncomingRequestCfProperties', 'Buffer', 'process', 'NodeJS']);
  function visit(file: string): void {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function check(node: ts.Node): void {
      if (ts.isIdentifier(node)) expect(forbidden.has(node.text), `${file}: ${node.text}`).toBe(false);
      ts.forEachChild(node, check);
    }
    check(ast);
    for (const imported of ts.preProcessFile(source).importedFiles) {
      const name = imported.fileName;
      if (!name.startsWith('.')) {
        expect(name === 'zod' || name.startsWith('@modelcontextprotocol/sdk/'), `${file}: ${name}`).toBe(true);
        continue;
      }
      const base = resolve(dirname(file), name);
      const target = [`${base}.ts`, resolve(base, 'index.ts')].find(existsSync);
      expect(target, `${file}: ${name}`).toBeDefined();
      if (target !== undefined) visit(target);
    }
  }
  visit(resolve(import.meta.dirname, '../core/router.ts'));
  expect(seen.size).toBeGreaterThan(8);
});
