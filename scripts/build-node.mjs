import { build } from 'esbuild';
await build({ entryPoints: ['node/main.ts', 'node/cli.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', outdir: 'dist/server', outExtension: { '.js': '.mjs' } });
