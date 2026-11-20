// 從 tokens.ts 產生 tokens.css，並把同一份 CSS 內嵌進 overview.html（讓它維持單檔自包含）。
// 用法：node docs/design/system/build.mjs
// 跑完會接著跑 contrast.mjs --write，把對比結果寫進 components.md。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const { palette, themes, scale, reducedMotion } = await import(join(here, 'tokens.ts'));

const paletteByHex = new Map(Object.entries(palette).map(([k, v]) => [v.toUpperCase(), k]));
const decl = (obj, indent = '  ', note = true) =>
  Object.entries(obj)
    .map(([k, v]) => {
      const p = note && paletteByHex.get(String(v).toUpperCase());
      return `${indent}--${k}: ${v};${p ? ` /* ${p} */` : ''}`;
    })
    .join('\n');

const css = `/* Nextline design tokens（NX-148；NX-169 改成品牌方向 A「定線 Steady」）
 * 由 build.mjs 從 tokens.ts 產生，不要手改；改 tokens.ts 再跑 node docs/design/system/build.mjs。
 * 深淺色：預設跟系統（prefers-color-scheme）；<html data-theme="light|dark"> 手動指定，
 * 也可以放在任何容器上，只影響那一塊。
 */

:root {
  /* 原始色盤 */
${decl(palette, '  ', false)}

  /* 尺度 */
${decl(scale)}
}

:root,
[data-theme="light"] {
  color-scheme: light;
${decl(themes.light)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${decl(themes.dark, '    ')}
  }
}

[data-theme="dark"] {
  color-scheme: dark;
${decl(themes.dark)}
}

@media (prefers-reduced-motion: reduce) {
  :root {
${decl(reducedMotion, '    ')}
  }
}
`;

writeFileSync(join(here, 'tokens.css'), css);
console.log(`tokens.css：${css.split('\n').length} 行`);

const html = join(here, 'overview.html');
const inject = (text, start, end, body) => {
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < 0) throw new Error(`overview.html 找不到 ${start}／${end} 標記`);
  return text.slice(0, i + start.length) + '\n' + body + '\n' + text.slice(j);
};
let out = readFileSync(html, 'utf8');
out = inject(out, '/* tokens:start */', '/* tokens:end */', css);
out = inject(
  out,
  '/* tokens-data:start */',
  '/* tokens-data:end */',
  `const TOKENS = ${JSON.stringify({ palette, light: themes.light, dark: themes.dark, scale })};`,
);
writeFileSync(html, out);
console.log('overview.html：已更新內嵌的 tokens');

execFileSync(process.execPath, [join(here, 'contrast.mjs'), '--write'], { stdio: 'inherit' });
