/**
 * Nextline design tokens（NX-148；NX-169 改成品牌方向 A「定線 Steady」）。
 *
 * 這一份是正本：tokens.css 由 build.mjs 從這裡產生，overview.html 內嵌的 tokens 也是。
 * 改色值只改這裡，再跑 `node docs/design/system/build.mjs`（會順便重跑對比檢查）。
 *
 * 命名：CSS 變數 = `--` + key。例：themes.light['color-bg'] → `--color-bg`。
 * React 裡優先用 CSS 變數（`var(--color-bg)`），跟著深淺色自動切換；
 * 只有 canvas、圖表這類拿不到 CSS 的地方才直接讀這裡的數值。
 */

/* ------------------------------------------------------------------ */
/* 1. 原始色盤（不分深淺色）：品牌色、agent 色、中性色階                     */
/* ------------------------------------------------------------------ */

export const palette = {
  /** 冷灰中性色（冷白 → 深墨）。淺色模式用 0～500、600、800；深色模式改用下面的暗灰。 */
  'neutral-0': '#FFFFFF',
  'neutral-50': '#F5F7FA',
  'neutral-100': '#EEF1F5',
  'neutral-150': '#E1E6ED',
  'neutral-200': '#C7CFDA',
  'neutral-300': '#93A1B2',
  'neutral-400': '#7A8696',
  'neutral-500': '#5B6675',
  'neutral-600': '#334458',
  'neutral-700': '#22303F',
  'neutral-750': '#1A2432',
  'neutral-800': '#0F1B2D',
  'neutral-850': '#121A26',
  'neutral-900': '#0B111A',

  /** 暗灰（深色模式，NX-169 第二輪）：比冷灰深色階亮、彩度低。 */
  'graphite-200': '#D5DBE3',
  'graphite-300': '#B8C0CB',
  'graphite-400': '#9CA4AF',
  'graphite-600': '#4A5363',
  'graphite-700': '#3A4250',
  'graphite-750': '#313844',
  'graphite-800': '#282E37',
  'graphite-850': '#232831',
  'graphite-900': '#1F242C',

  /** 品牌主色：墨藍。人、主要按鈕、焦點框。淺色用 400～700，深色用 100～300、900。 */
  'brand-50': '#E8EEF5',
  'brand-100': '#BFD3EC',
  'brand-200': '#A9C4E8',
  'brand-300': '#8FB3E0',
  'brand-400': '#2C5282',
  'brand-500': '#1E3A5F',
  'brand-600': '#172E4C',
  'brand-700': '#11233A',
  'brand-800': '#16304F',
  'brand-900': '#1A2A3E',

  /** 輔色：青綠。agent。500 是品牌原色（淺色當文字對比不夠，文字用 600）；300 是 logo 與深色模式。 */
  'agent-50': '#DDF3EF',
  'agent-300': '#2DD4BF',
  'agent-500': '#0E8F80',
  'agent-600': '#0B7568',
  'agent-900': '#123A37',
} as const;

/* ------------------------------------------------------------------ */
/* 2. 語意色（深淺色各一份，key 完全相同）                                 */
/* ------------------------------------------------------------------ */

/** 票的 6 個狀態。fg＝文字與圖示（≥4.5），solid＝色點、欄頂色條（≥3），soft＝徽章底色。 */
export const ticketStatuses = ['backlog', 'todo', 'in-progress', 'in-review', 'done', 'canceled'] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

/** 介面顯示的名稱。API 名稱：Backlog、Todo、In Progress、In Review、Done、Canceled。 */
export const ticketStatusLabel: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  'in-progress': 'In Progress',
  'in-review': '待驗收',
  done: 'Done',
  canceled: 'Canceled',
};

/** agent session 的 8 個狀態（IA README 第 2 段）。 */
export const sessionStates = [
  'pending',
  'active',
  'awaiting-input',
  'error',
  'stale',
  'stopping',
  'stopped',
  'complete',
] as const;
export type SessionState = (typeof sessionStates)[number];

export const sessionStateLabel: Record<SessionState, string> = {
  pending: '等 agent 接手',
  active: '進行中',
  'awaiting-input': '等你回覆',
  error: '出錯',
  stale: '太久沒更新',
  stopping: '停止中…',
  stopped: '已停止',
  complete: '做完了',
};

export const projectColorCount = 10;

/** Project 色盤的名字（色點旁不顯示，只給設定頁的選色器 aria-label 用）。 */
export const projectColorName = ['紅陶', '琥珀', '橄欖', '綠', '青', '藍', '靛', '梅', '玫瑰', '岩'] as const;

const light = {
  /* 面 */
  'color-bg': '#F5F7FA',
  'color-surface': '#FFFFFF',
  'color-surface-2': '#EEF1F5',
  'color-surface-raised': '#FFFFFF',
  'color-sidebar': '#EEF1F5',
  'color-hover': '#E6EAF0',
  'color-selected': '#E8EEF5',
  'color-review-col': '#F3F2EE',
  'color-scrim': 'rgb(15 27 45 / 40%)',
  'color-skeleton': '#E9EDF2',
  'color-skeleton-shine': '#F3F5F8',
  /* 線 */
  'color-line': '#E1E6ED',
  'color-line-strong': '#C7CFDA',
  'color-border-input': '#7A8696',
  /* 文字 */
  'color-text': '#0F1B2D',
  'color-text-muted': '#5B6675',
  'color-text-disabled': '#A3ADBA',
  /* 品牌 */
  'color-primary': '#1E3A5F',
  'color-primary-hover': '#172E4C',
  'color-primary-active': '#11233A',
  'color-on-primary': '#FFFFFF',
  'color-primary-soft': '#E8EEF5',
  'color-link': '#2C5282',
  'color-focus': '#2C5282',
  /* agent */
  'color-agent': '#0B7568',
  'color-agent-soft': '#DDF3EF',
  /* 危險 */
  'color-danger': '#C62828',
  'color-danger-hover': '#A61F1F',
  'color-on-danger': '#FFFFFF',
  'color-danger-soft': '#FBEAEA',
  /* 反白浮層：toast、tooltip */
  'color-inverse-bg': '#0F1B2D',
  'color-inverse-text': '#F5F7FA',
  'color-inverse-muted': '#C7CFDA',
  'color-inverse-action': '#8FB3E0',
  /* logo 的方角容器（directions.html MARK.a；兩條橫線固定白色與青綠 agent-300） */
  'color-logo-bg': '#1E3A5F',
  /* 詳細頁待驗收 block（.nl-review）：底色、琥珀圖示、左側邊條（淺色維持原樣：琥珀淡底、沒有邊條） */
  'color-review-bg': '#F9F0E6',
  'color-review-icon': '#B45309',
  'shadow-review': 'none',

  /* 票狀態 */
  'status-backlog-fg': '#5B6675',
  'status-backlog-solid': '#7A8696',
  'status-backlog-soft': '#EEF1F5',
  'status-todo-fg': '#334458',
  'status-todo-solid': '#334458',
  'status-todo-soft': '#EEF1F5',
  'status-in-progress-fg': '#1D4FC4',
  'status-in-progress-solid': '#2563EB',
  'status-in-progress-soft': '#EAF0FB',
  'status-in-review-fg': '#9A4508',
  'status-in-review-solid': '#B45309',
  'status-in-review-soft': '#F9F0E6',
  'status-done-fg': '#116B33',
  'status-done-solid': '#15803D',
  'status-done-soft': '#E8F3EC',
  'status-canceled-fg': '#5B6675',
  'status-canceled-solid': '#7A8696',
  'status-canceled-soft': '#EEF1F5',

  /* agent session 狀態 */
  'session-pending-fg': '#0B7568',
  'session-pending-solid': '#0E8F80',
  'session-pending-soft': '#DDF3EF',
  'session-active-fg': '#1D4FC4',
  'session-active-solid': '#2563EB',
  'session-active-soft': '#EAF0FB',
  'session-awaiting-input-fg': '#9A4508',
  'session-awaiting-input-solid': '#B45309',
  'session-awaiting-input-soft': '#F9F0E6',
  'session-error-fg': '#C62828',
  'session-error-solid': '#C62828',
  'session-error-soft': '#FBEAEA',
  'session-stale-fg': '#5B6675',
  'session-stale-solid': '#6B7280',
  'session-stale-soft': '#EEF1F5',
  'session-stopping-fg': '#C62828',
  'session-stopping-solid': '#C62828',
  'session-stopping-soft': '#FBEAEA',
  'session-stopped-fg': '#334458',
  'session-stopped-solid': '#334458',
  'session-stopped-soft': '#EEF1F5',
  'session-complete-fg': '#116B33',
  'session-complete-solid': '#15803D',
  'session-complete-soft': '#E8F3EC',

  /* Project 色盤：色點、Project 名稱前的小方塊（方向 A：降低彩度，跟冷灰底同一個溫度） */
  'project-1': '#A8563F',
  'project-2': '#94680F',
  'project-3': '#66722A',
  'project-4': '#2F7A55',
  'project-5': '#1D7470',
  'project-6': '#3A64A0',
  'project-7': '#5A55A0',
  'project-8': '#8E4A82',
  'project-9': '#B0485F',
  'project-10': '#64707E',

  /* 陰影：冷色調、貼近表面；一圈 1px 的淡邊讓卡片邊緣清楚（方向 A） */
  'shadow-sm': '0 0 0 1px rgb(15 27 45 / 6%), 0 1px 2px rgb(15 27 45 / 6%)',
  'shadow-md': '0 0 0 1px rgb(15 27 45 / 6%), 0 4px 12px rgb(15 27 45 / 8%)',
  'shadow-lg': '0 0 0 1px rgb(15 27 45 / 6%), 0 12px 32px rgb(15 27 45 / 12%)',
  'shadow-overlay': '0 0 0 1px rgb(15 27 45 / 8%), 0 24px 56px rgb(15 27 45 / 18%)',
  'shadow-button': '0 1px 0 rgb(15 27 45 / 10%)',
  'shadow-drag': '0 0 0 1px rgb(15 27 45 / 8%), 0 12px 28px rgb(15 27 45 / 16%)',
} as const;

export type ThemeTokens = { readonly [K in keyof typeof light]: string };

const dark: ThemeTokens = {
  /* 深色是「暗灰」（NX-169 第二輪，2026-11-05 Bolas）：比方向 A 原本的深墨亮，彩度低，面與面之間的層次分得出 */
  'color-bg': '#1F242C',
  'color-surface': '#282E37',
  'color-surface-2': '#313844',
  'color-surface-raised': '#313844',
  'color-sidebar': '#232831',
  'color-hover': '#313844',
  'color-selected': '#2F3A4A',
  'color-review-col': '#353943',
  'color-scrim': 'rgb(10 12 16 / 55%)',
  'color-skeleton': '#313844',
  'color-skeleton-shine': '#3A4250',
  'color-line': '#3A4250',
  'color-line-strong': '#4A5363',
  'color-border-input': '#9CA4AF',
  'color-text': '#D5DBE3',
  'color-text-muted': '#B8C0CB',
  'color-text-disabled': '#5E6776',
  'color-primary': '#8FB3E0',
  'color-primary-hover': '#A9C4E8',
  'color-primary-active': '#BFD3EC',
  'color-on-primary': '#14171C',
  'color-primary-soft': '#2F3A4A',
  'color-link': '#A9C4E8',
  'color-focus': '#8FB3E0',
  'color-agent': '#73D0C2',
  'color-agent-soft': '#2A403F',
  'color-danger': '#F3ACAC',
  'color-danger-hover': '#F7C2C2',
  'color-on-danger': '#14171C',
  'color-danger-soft': '#45333A',
  'color-inverse-bg': '#D5DBE3',
  'color-inverse-text': '#1F242C',
  'color-inverse-muted': '#4A5363',
  'color-inverse-action': '#2C5282',
  'color-logo-bg': '#2A4568',
  /* 待驗收 block：不用褐色實心底，改成比頁面亮的 surface-2＋左側 3px 琥珀邊＋亮一點的琥珀圖示 */
  'color-review-bg': '#313844',
  'color-review-icon': '#E2B36E',
  'shadow-review': 'inset 3px 0 0 #E2B36E',

  'status-backlog-fg': '#BAC1CC',
  'status-backlog-solid': '#9CA4AF',
  'status-backlog-soft': '#363D49',
  'status-todo-fg': '#C3CAD4',
  'status-todo-solid': '#C3CAD4',
  'status-todo-soft': '#363D49',
  'status-in-progress-fg': '#A4C2EA',
  'status-in-progress-solid': '#86AEE3',
  'status-in-progress-soft': '#2F3B4E',
  'status-in-review-fg': '#E8C07E',
  'status-in-review-solid': '#D6A45E',
  'status-in-review-soft': '#463C24',
  'status-done-fg': '#95CDA9',
  'status-done-solid': '#74BE8E',
  'status-done-soft': '#2E4136',
  'status-canceled-fg': '#BAC1CC',
  'status-canceled-solid': '#9CA4AF',
  'status-canceled-soft': '#363D49',

  'session-pending-fg': '#73D0C2',
  'session-pending-solid': '#73D0C2',
  'session-pending-soft': '#2A403F',
  'session-active-fg': '#A4C2EA',
  'session-active-solid': '#86AEE3',
  'session-active-soft': '#2F3B4E',
  'session-awaiting-input-fg': '#E8C07E',
  'session-awaiting-input-solid': '#D6A45E',
  'session-awaiting-input-soft': '#463C24',
  'session-error-fg': '#F3ACAC',
  'session-error-solid': '#EE8C8C',
  'session-error-soft': '#45333A',
  'session-stale-fg': '#BAC1CC',
  'session-stale-solid': '#9FA6B1',
  'session-stale-soft': '#363D49',
  'session-stopping-fg': '#F3ACAC',
  'session-stopping-solid': '#EE8C8C',
  'session-stopping-soft': '#45333A',
  'session-stopped-fg': '#C3CAD4',
  'session-stopped-solid': '#C3CAD4',
  'session-stopped-soft': '#363D49',
  'session-complete-fg': '#95CDA9',
  'session-complete-solid': '#74BE8E',
  'session-complete-soft': '#2E4136',

  'project-1': '#D09482',
  'project-2': '#CDA96C',
  'project-3': '#A9B37A',
  'project-4': '#84BC9C',
  'project-5': '#7BBDB5',
  'project-6': '#8FB3E0',
  'project-7': '#A8A4D8',
  'project-8': '#C99BBF',
  'project-9': '#D99DAC',
  'project-10': '#A3ADBA',

  'shadow-sm': '0 0 0 1px rgb(255 255 255 / 4%), 0 1px 2px rgb(0 0 0 / 22%)',
  'shadow-md': '0 0 0 1px rgb(255 255 255 / 5%), 0 6px 16px rgb(0 0 0 / 22%)',
  'shadow-lg': '0 0 0 1px rgb(255 255 255 / 6%), 0 14px 36px rgb(0 0 0 / 30%)',
  'shadow-overlay': '0 0 0 1px rgb(255 255 255 / 6%), 0 24px 64px rgb(0 0 0 / 42%)',
  'shadow-button': '0 1px 0 rgb(0 0 0 / 28%)',
  'shadow-drag': '0 0 0 1px rgb(255 255 255 / 6%), 0 14px 32px rgb(0 0 0 / 34%)',
};

export const themes = { light: light as ThemeTokens, dark } as const;
export type ThemeName = keyof typeof themes;

/* ------------------------------------------------------------------ */
/* 3. 不分深淺色的尺度                                                    */
/* ------------------------------------------------------------------ */

export const scale = {
  /* 字體：英文數字 Inter、中文蘋方／思源黑體、票號與張數 JetBrains Mono（品牌方向 A，數字等寬，張數變動不會跳） */
  'font-sans':
    'Inter, "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  'font-mono': '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',

  /* 字重：方向 A 只用 400／600，標題靠字級分層，不再加粗 */
  'font-weight-regular': '400',
  'font-weight-semibold': '600',
  'font-weight-bold': '600',

  /* 字級：內文 15px；WCAG 大字以 24px 起算（600 不算粗體） */
  'font-size-xs': '12px',
  'font-size-sm': '13px',
  'font-size-md': '15px',
  'font-size-lg': '17px',
  'font-size-xl': '20px',
  'font-size-2xl': '24px',
  'font-size-3xl': '30px',

  'line-height-tight': '1.25',
  'line-height-snug': '1.4',
  'line-height-normal': '1.6',

  /* 間距：4px 為基準 */
  'space-0': '0px',
  'space-0-5': '2px',
  'space-1': '4px',
  'space-1-5': '6px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'space-10': '40px',
  'space-12': '48px',
  'space-16': '64px',

  /* 圓角：方向 A 精準、方角容器。xs 跟圖示轉角同為 2px；按鈕、輸入框、徽章用 sm；只有張數計數保留膠囊 */
  'radius-xs': '2px',
  'radius-sm': '4px',
  'radius-md': '6px',
  'radius-lg': '8px',
  'radius-pill': '999px',
  'radius-round': '50%',

  /* 元件尺寸 */
  'size-control-sm': '28px',
  'size-control-md': '36px',
  'size-control-lg': '44px',
  'size-icon-sm': '16px',
  'size-icon-md': '20px',
  'size-icon-lg': '24px',
  'size-avatar-sm': '20px',
  'size-avatar-md': '24px',
  'size-avatar-lg': '32px',
  'size-sidebar': '248px',
  'size-peek': '480px',
  'size-topbar': '52px',
  'size-tabbar': '56px',
  'size-board-col': '296px',
  'size-modal-sm': '420px',
  'size-modal-md': '600px',
  'size-palette': '640px',
  'size-toast': '420px',
  'size-tooltip': '280px',

  /* 圖示：24px 格、線寬 1.5px、轉角 2px、圓頭（方向 A） */
  'icon-stroke': '1.5px',

  /* 疊層 */
  'z-base': '0',
  'z-sticky': '10',
  'z-dropdown': '100',
  'z-peek': '200',
  'z-modal': '300',
  'z-palette': '400',
  'z-toast': '500',
  'z-tooltip': '600',

  /* 動效 */
  'duration-instant': '80ms',
  'duration-fast': '120ms',
  'duration-base': '180ms',
  'duration-slow': '240ms',
  'duration-slower': '320ms',
  'duration-toast': '4000ms',
  'duration-toast-undo': '10000ms',
  'duration-updated-flash': '5000ms',
  'ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  'ease-enter': 'cubic-bezier(0, 0, 0.2, 1)',
  'ease-exit': 'cubic-bezier(0.4, 0, 1, 1)',
  'ease-spring': 'cubic-bezier(0.3, 1.3, 0.5, 1)',

  /* 斷點（CSS 的 @media 不能用變數，這裡給 JS 與文件對照） */
  'breakpoint-sm': '560px',
  'breakpoint-md': '760px',
  'breakpoint-lg': '1024px',
  'breakpoint-xl': '1280px',
} as const;

/** prefers-reduced-motion: reduce 時覆寫的值（toast 停留時間不變）。 */
export const reducedMotion = {
  'duration-instant': '0ms',
  'duration-fast': '0ms',
  'duration-base': '0ms',
  'duration-slow': '0ms',
  'duration-slower': '0ms',
} as const;

export type TokenName = keyof typeof scale | keyof ThemeTokens | keyof typeof palette;

/** 取 CSS 變數。例：`cssVar('color-primary')` → `var(--color-primary)`。 */
export const cssVar = (name: TokenName): string => `var(--${name})`;

export const statusVar = (s: TicketStatus, part: 'fg' | 'solid' | 'soft'): string => `var(--status-${s}-${part})`;
export const sessionVar = (s: SessionState, part: 'fg' | 'solid' | 'soft'): string => `var(--session-${s}-${part})`;

/** Project 的顏色由 id 決定，同一個 Project 永遠同一色。 */
export const projectColorVar = (projectId: number): string => {
  const index = ((((projectId - 1) % projectColorCount) + projectColorCount) % projectColorCount) + 1;
  return `var(--project-${String(index)})`;
};
