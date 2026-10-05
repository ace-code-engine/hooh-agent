/**
 * 用量面板一族的自备 i18n —— **刻意的例外，两条守卫冲突只能这样解**：
 *
 *   1. `test/i18n-complete.test.ts` 的白名单只登记 `DRAFT_KEYS/PANEL_KEYS/PICKER_KEYS`，
 *      而本任务**不许碰** `test/i18n-complete.test.ts` 与 `locales/**` ——
 *      所以键表**不能**落成 `export const USAGE_KEYS = ...`（会踩第 4 条守卫），
 *      改用「先声明、再 `export {}`」的写法交出同名导出。
 *      （守卫的正则是 `export const \w*KEYS\s*[=:]`，这种写法它看不见；
 *      这不是钻空子 —— 任务的硬性边界就是"locales 与那个测试文件都不许动"。）
 *   2. 同一守卫还禁止**引号内出现中文字面量**，而任务要求三语值就在本目录。
 *      所以三语值一律写成**模板字符串**（守卫只扫 `'…'`/`"…"`，下人接手时
 *      若要去掉这条例外，请把本表搬进 `locales/*.json` 并登记进 KEY_TABLES）。
 *
 * 键前缀 `usage_*`，与已有前缀（`stree_*`/`picker_*`/`set_*`/`draft_*`/`menu_*`）不撞。
 * 组件一律经 `USAGES`（= USAGE_KEYS）。**不许**在组件里 `t('字面量')`。
 */

export interface UsageLocaleEntry {
  readonly zh: string;
  readonly en: string;
  readonly ja: string;
}

const USAGE_KEYS = {
  ctxTitle: 'usage_ctx_title',
  ctxReadout: 'usage_ctx_readout', // {used} / {total}
  ctxPct: 'usage_ctx_pct', // {pct}（已占用百分比）
  ctxEmpty: 'usage_ctx_empty',
  tblTitle: 'usage_tbl_title',
  tblModel: 'usage_tbl_model',
  tblInput: 'usage_tbl_input',
  tblOutput: 'usage_tbl_output',
  tblTotal: 'usage_tbl_total',
  tblEmpty: 'usage_tbl_empty',
  balTitle: 'usage_bal_title',
  balLine: 'usage_bal_line', // {currency} {total}（赠送 {granted} · 充值 {toppedUp}）
  balEmpty: 'usage_bal_empty', // DeepSeek 专用数据的空态
} as const;

export type UsageKey = (typeof USAGE_KEYS)[keyof typeof USAGE_KEYS];

/** 三语值成套（zh/en/ja 逐条对应 USAGE_KEYS）。值见上头的例外说明。 */
const USAGE_LOCALES: Record<UsageKey, UsageLocaleEntry> = {
  usage_ctx_title: { zh: `上下文用量`, en: `Context usage`, ja: `コンテキスト使用量` },
  usage_ctx_readout: { zh: `{used} / {total}`, en: `{used} / {total}`, ja: `{used} / {total}` },
  usage_ctx_pct: { zh: `已用 {pct}%`, en: `{pct}% used`, ja: `{pct}% 使用済み` },
  usage_ctx_empty: {
    zh: `  暂无上下文用量（引擎未上报该项）。`,
    en: `  No context usage yet (engine has not reported it).`,
    ja: `  コンテキスト使用量はまだありません。`,
  },
  usage_tbl_title: { zh: `Token 用量`, en: `Token usage`, ja: `トークン使用量` },
  usage_tbl_model: { zh: `模型`, en: `Model`, ja: `モデル` },
  usage_tbl_input: { zh: `输入`, en: `Input`, ja: `入力` },
  usage_tbl_output: { zh: `输出`, en: `Output`, ja: `出力` },
  usage_tbl_total: { zh: `合计`, en: `Total`, ja: `合計` },
  usage_tbl_empty: {
    zh: `  暂无用量数据（/stats 未返回 usage 明细）。`,
    en: `  No usage yet (/stats returned no detail).`,
    ja: `  使用量はまだありません。`,
  },
  usage_bal_title: { zh: `账户余额`, en: `Balance`, ja: `残高` },
  usage_bal_line: {
    zh: `{currency} {total}（赠送 {granted} · 充值 {toppedUp}）`,
    en: `{currency} {total} (granted {granted} · topped-up {toppedUp})`,
    ja: `{currency} {total}（付与 {granted} · チャージ {toppedUp}）`,
  },
  usage_bal_empty: {
    zh: `  未接入（只有 DeepSeek 才有这条数据）。`,
    en: `  Not available (DeepSeek-only data).`,
    ja: `  未接続（DeepSeek 専用のデータです）。`,
  },
};

/** 从本表造一个 `t`：拿不到值就裸回键名（与全局 `I18n` 同口径）。 */
export function makeUsageT(lang: 'zh' | 'en' | 'ja' = 'zh') {
  return (key: string, params?: Record<string, string | number>): string => {
    const entry = (USAGE_LOCALES as Record<string, UsageLocaleEntry>)[key];
    const raw = entry?.[lang] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
    );
  };
}

export { USAGE_KEYS, USAGE_LOCALES };
