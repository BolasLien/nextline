// WCAG 2.2 對比檢查：讀 tokens.ts，算出每一組「文字／UI 元件 × 背景」的對比值。
// 用法：node docs/design/system/contrast.mjs          只印結果，有不及格就 exit 1
//       node docs/design/system/contrast.mjs --write  另外把結果寫進 components.md 最後一段
// 門檻：正文 4.5（SC 1.4.3）；大字與 UI 元件（邊框、色點、焦點框、按鈕底色）3（SC 1.4.3、1.4.11）。
// 停用狀態依 WCAG 不列入（SC 1.4.3 例外）。
// 深色主題另外跑 APCA（NX-169 第三輪，2026-11-05）：WCAG 2 的公式在深色底上會高估對比，
// 所以深色多一道 APCA-W3 0.0.98G 檢查（WCAG 3 草案的可讀性算法），淺色只看 WCAG。
//   門檻（取絕對值 Lc）：內文、卡片標題（color-text、toast 文字）≥ 75；其他文字（次要文字、標籤、票號、徽章、連結、按鈕字）≥ 60；
//   非文字（圖示、色點、框線，WCAG 門檻 3 的那些）≥ 45。
//   另外檢查：待驗收欄 color-review-col 不能比其他欄（color-surface-2）暗。
//   演算法來源：https://github.com/Myndex/apca-w3（src/apca-w3.js，0.0.98G-4g 常數），說明 https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { themes, ticketStatuses, sessionStates, ticketStatusLabel, sessionStateLabel, projectColorCount } = await import(
  join(here, 'tokens.ts')
);

const TEXT = 4.5;
const UI = 3;

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// APCA-W3 0.0.98G：sRGB 直接 2.4 次方（不是 WCAG 的分段公式），係數同 apca-w3 套件。
const APCA = { mainTRC: 2.4, sR: 0.2126729, sG: 0.7151522, sB: 0.072175, normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65, blkThrs: 0.022, blkClmp: 1.414, scale: 1.14, offset: 0.027, deltaYmin: 0.0005, loClip: 0.1 };
function apcaY(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** APCA.mainTRC);
  return APCA.sR * r + APCA.sG * g + APCA.sB * b;
}
/** 回傳 Lc（深底淺字是負值）。 */
export function apca(textHex, bgHex) {
  const clamp = (y) => (y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp);
  const txt = clamp(apcaY(textHex));
  const bg = clamp(apcaY(bgHex));
  if (Math.abs(bg - txt) < APCA.deltaYmin) return 0;
  if (bg > txt) {
    const sapc = (bg ** APCA.normBG - txt ** APCA.normTXT) * APCA.scale;
    return sapc < APCA.loClip ? 0 : (sapc - APCA.offset) * 100;
  }
  const sapc = (bg ** APCA.revBG - txt ** APCA.revTXT) * APCA.scale;
  return sapc > -APCA.loClip ? 0 : (sapc + APCA.offset) * 100;
}
const apcaMin = (fg, min) => (min === UI ? 45 : fg === 'color-text' || fg === 'color-inverse-text' ? 75 : 60);

/** 每一組：[前景 token, 背景 token, 門檻, 用在哪裡] */
function pairs() {
  const out = [];
  const add = (fg, bg, min, use) => out.push([fg, bg, min, use]);

  for (const bg of ['bg', 'surface', 'surface-2', 'sidebar', 'hover', 'selected', 'review-col', 'primary-soft', 'agent-soft', 'danger-soft'])
    add('color-text', `color-${bg}`, TEXT, '正文');
  for (const bg of ['bg', 'surface', 'surface-2', 'sidebar', 'hover', 'selected', 'review-col'])
    add('color-text-muted', `color-${bg}`, TEXT, '次要文字、placeholder、票號');
  for (const bg of ['primary', 'primary-hover', 'primary-active']) add('color-on-primary', `color-${bg}`, TEXT, '主要按鈕文字、人的頭像字');
  for (const bg of ['danger', 'danger-hover']) add('color-on-danger', `color-${bg}`, TEXT, '危險按鈕文字');
  for (const bg of ['bg', 'surface', 'primary-soft']) add('color-link', `color-${bg}`, TEXT, '連結、文字按鈕');
  for (const bg of ['surface', 'agent-soft', 'bg']) add('color-agent', `color-${bg}`, TEXT, 'agent 名稱、agent 頭像圖示');
  for (const bg of ['surface', 'danger-soft', 'bg']) add('color-danger', `color-${bg}`, TEXT, '錯誤訊息');
  add('color-inverse-text', 'color-inverse-bg', TEXT, 'toast、tooltip 文字');
  add('color-inverse-muted', 'color-inverse-bg', TEXT, 'tooltip 快捷鍵');
  add('color-inverse-action', 'color-inverse-bg', TEXT, 'toast「復原」「重試」');
  // 詳細頁待驗收 block（.nl-review）
  add('color-text', 'color-review-bg', TEXT, '待驗收 block：下一步文字');
  add('color-text-muted', 'color-review-bg', TEXT, '待驗收 block：說明文字');
  add('color-review-icon', 'color-review-bg', UI, '待驗收 block：琥珀圖示');
  add('color-review-icon', 'color-surface', UI, '待驗收 block：左側琥珀邊（對頁面卡片）');
  // 看板待驗收欄
  add('status-in-review-solid', 'color-review-col', UI, '待驗收欄：虛線框、欄頂圖示');
  add('color-text', 'color-review-col', TEXT, '待驗收欄：欄標題');

  for (const s of ticketStatuses) {
    const name = `票狀態 ${ticketStatusLabel[s]}`;
    add(`status-${s}-fg`, `status-${s}-soft`, TEXT, `${name}：徽章文字`);
    add(`status-${s}-fg`, 'color-surface', TEXT, `${name}：卡片上的狀態文字`);
    add(`status-${s}-solid`, 'color-surface', UI, `${name}：色點／圖示`);
    add(`status-${s}-solid`, 'color-bg', UI, `${name}：欄頂色點`);
  }
  for (const s of sessionStates) {
    const name = `session ${sessionStateLabel[s]}`;
    add(`session-${s}-fg`, `session-${s}-soft`, TEXT, `${name}：徽章文字`);
    add(`session-${s}-fg`, 'color-surface', TEXT, `${name}：卡片上的文字`);
    add(`session-${s}-solid`, `session-${s}-soft`, UI, `${name}：徽章色點`);
    add(`session-${s}-solid`, 'color-surface', UI, `${name}：色點`);
  }
  for (let i = 1; i <= projectColorCount; i++) {
    add(`project-${i}`, 'color-surface', UI, `Project 色 ${i}：卡片上的色點`);
    add(`project-${i}`, 'color-sidebar', UI, `Project 色 ${i}：側欄色點`);
  }

  for (const bg of ['bg', 'surface', 'surface-2']) add('color-border-input', `color-${bg}`, UI, '輸入框、勾選框邊框');
  for (const bg of ['bg', 'surface', 'surface-2', 'sidebar']) add('color-focus', `color-${bg}`, UI, '焦點框');
  for (const bg of ['bg', 'surface']) add('color-primary', `color-${bg}`, UI, '主要按鈕底色、選取指示條');
  add('color-danger', 'color-surface', UI, '危險按鈕底色、錯誤框');
  add('color-agent', 'color-surface', UI, 'agent 頭像外框');
  add('color-primary', 'color-surface', UI, '人的頭像底色');
  return out;
}

const results = {};
let failed = 0;
for (const [theme, t] of Object.entries(themes)) {
  results[theme] = pairs().map(([fg, bg, min, use]) => {
    if (!t[fg] || !t[bg]) throw new Error(`${theme}: 找不到 token ${t[fg] ? bg : fg}`);
    const r = ratio(t[fg], t[bg]);
    if (r < min) failed++;
    return { fg, bg, fgHex: t[fg], bgHex: t[bg], min, use, r };
  });
}

// 深色：APCA
const apcaRows = results.dark.map((x) => ({ ...x, lc: Math.abs(apca(x.fgHex, x.bgHex)), lcMin: apcaMin(x.fg, x.min) }));
const apcaBad = apcaRows.filter((x) => x.lc < x.lcMin);
const darkT = themes.dark;
const colOk = apcaY(darkT['color-review-col']) >= apcaY(darkT['color-surface-2']);
failed += apcaBad.length + (colOk ? 0 : 1);

const total = results.light.length + results.dark.length;
for (const [theme, rows] of Object.entries(results)) {
  const bad = rows.filter((x) => x.r < x.min);
  const worst = [...rows].sort((a, b) => a.r / a.min - b.r / b.min)[0];
  console.log(`${theme}: ${rows.length} 組，不及格 ${bad.length}；最接近門檻：${worst.fg} on ${worst.bg} = ${worst.r.toFixed(2)}（門檻 ${worst.min}）`);
  for (const b of bad) console.log(`  ✗ ${b.fg} ${b.fgHex} on ${b.bg} ${b.bgHex} = ${b.r.toFixed(2)} < ${b.min}  ${b.use}`);
}
{
  const worst = [...apcaRows].sort((a, b) => a.lc / a.lcMin - b.lc / b.lcMin)[0];
  console.log(`dark APCA: ${apcaRows.length} 組，不及格 ${apcaBad.length}；最接近門檻：${worst.fg} on ${worst.bg} = Lc ${worst.lc.toFixed(1)}（門檻 ${worst.lcMin}）`);
  for (const b of apcaBad) console.log(`  ✗ ${b.fg} ${b.fgHex} on ${b.bg} ${b.bgHex} = Lc ${b.lc.toFixed(1)} < ${b.lcMin}  ${b.use}`);
  console.log(colOk ? 'dark: 待驗收欄不比其他欄暗' : `  ✗ dark: 待驗收欄 ${darkT['color-review-col']} 比其他欄 ${darkT['color-surface-2']} 暗`);
}
console.log(failed ? `不及格 ${failed} 組` : `全部 ${total} 組 WCAG 與深色 ${apcaRows.length} 組 APCA 通過`);

if (process.argv.includes('--write')) {
  const md = join(here, 'components.md');
  const src = readFileSync(md, 'utf8');
  const start = '<!-- contrast:start -->';
  const end = '<!-- contrast:end -->';
  const table = (rows) =>
    ['| 前景 | 背景 | 用途 | 對比 | 門檻 | 結果 |', '|---|---|---|---|---|---|']
      .concat(
        rows.map(
          (x) =>
            `| \`${x.fg}\` ${x.fgHex} | \`${x.bg}\` ${x.bgHex} | ${x.use} | ${x.r.toFixed(2)} | ${x.min} | ${x.r >= x.min ? '通過' : '**不及格**'} |`,
        ),
      )
      .join('\n');
  const summary = Object.entries(results)
    .map(([theme, rows]) => {
      const worst = [...rows].sort((a, b) => a.r / a.min - b.r / b.min).slice(0, 3);
      return `- ${theme === 'light' ? '淺色' : '深色'}：${rows.length} 組，不及格 ${rows.filter((x) => x.r < x.min).length} 組。最接近門檻的三組：${worst
        .map((w) => `\`${w.fg}\` on \`${w.bg}\` ${w.r.toFixed(2)}（門檻 ${w.min}）`)
        .join('、')}`;
    })
    .join('\n');
  const worstA = [...apcaRows].sort((a, b) => a.lc / a.lcMin - b.lc / b.lcMin).slice(0, 3);
  const apcaSummary = `- 深色 APCA（Lc 絕對值）：${apcaRows.length} 組，不及格 ${apcaBad.length} 組。最接近門檻的三組：${worstA.map((w) => `\`${w.fg}\` on \`${w.bg}\` Lc ${w.lc.toFixed(1)}（門檻 ${w.lcMin}）`).join('、')}`;
  const apcaTable = ['| 前景 | 背景 | 用途 | Lc | 門檻 | 結果 |', '|---|---|---|---|---|---|'].concat(apcaRows.map((x) => `| \`${x.fg}\` ${x.fgHex} | \`${x.bg}\` ${x.bgHex} | ${x.use} | ${x.lc.toFixed(1)} | ${String(x.lcMin)} | ${x.lc >= x.lcMin ? '通過' : '**不及格**'} |`)).join('\n');
  const block = `${start}\n${summary}\n${apcaSummary}\n\n<details><summary>淺色：全部 ${results.light.length} 組</summary>\n\n${table(results.light)}\n\n</details>\n\n<details><summary>深色：全部 ${results.dark.length} 組</summary>\n\n${table(results.dark)}\n\n</details>\n\n<details><summary>深色 APCA：全部 ${apcaRows.length} 組</summary>\n\n${apcaTable}\n\n</details>\n${end}`;
  const i = src.indexOf(start);
  const j = src.indexOf(end);
  if (i < 0 || j < 0) throw new Error('components.md 找不到 contrast:start／contrast:end 標記');
  writeFileSync(md, src.slice(0, i) + block + src.slice(j + end.length));
  console.log('已寫入 components.md');
}

process.exitCode = failed ? 1 : 0;
