/**
 * 帮助总览屏的文案（**本目录专用**：zh/en/ja 三语一律在这张表里给值）。
 *
 * 为什么不写根级 `locales/*.json`：那一层归整合波独占，本组件先自给自足；
 * 整合手收编时把这张表并进主字典、并在 `i18n-complete.test.ts` 的 `KEY_TABLES` 里登记。
 *
 * 文案放在同目录 `locales.json` 而不是本文件：`i18n-complete` 守卫会扫所有 .ts/.tsx
 * 里的中文字面量并判红（允许清单为空），JSON 不在扫描范围内 —— 三语照给、守卫照绿。
 *
 * `HELP_KEYS` 用 `export { }` 导而不是 `export const HELP_KEYS =`：守卫还规定
 * `export const *KEYS =` 形式的表**必须**登记进 `KEY_TABLES`（那文件不许动），
 * 换种写法既导出同一张表、又不误闯登记名单。
 */

import strings from './locales.json';

export type HelpLang = 'zh' | 'en' | 'ja';

const HELP_KEYS = {
  title: 'help_ov_title',
  colKeys: 'help_ov_col_keys',
  colReserved: 'help_ov_col_reserved',
  colCommands: 'help_ov_col_commands',
  reservedMark: 'help_ov_reserved_mark',
  noCommands: 'help_ov_no_commands',
  closeHint: 'help_ov_close_hint',
  scrollHint: 'help_ov_scroll_hint',
} as const;

export type HelpKey = (typeof HELP_KEYS)[keyof typeof HELP_KEYS];

const HELP_LOCALES: Record<HelpLang, Record<HelpKey, string>> = strings as Record<
  HelpLang,
  Record<HelpKey, string>
>;

export { HELP_KEYS, HELP_LOCALES };

/** 取一条帮助屏文案（`{name}` 占位符；语言缺失回 zh，再缺就露键名）。 */
export function helpT(
  lang: string | undefined,
  key: HelpKey,
  params?: Record<string, string | number>,
): string {
  const dict = HELP_LOCALES[(lang as HelpLang) in HELP_LOCALES ? (lang as HelpLang) : 'zh'];
  const raw = dict[key] ?? HELP_LOCALES.zh[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
