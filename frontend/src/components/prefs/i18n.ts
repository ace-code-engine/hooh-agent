/**
 * `prefs/` 这一族的文本零全量供给（zh/en/ja 三语都带）。**不并入根 locales** ——
 * 那一步归整合波（这波我要让你看到并批准之后再加）。
 */

export const PREFS_KEYS = {
  hint: "prefs_hint",
  close: "prefs_close",
  accentTitle: "prefs_accent_title",
  themeTitle: "prefs_theme_title",
  langTitle: "prefs_lang_title",
  effortTitle: "prefs_effort_title",
  effortAuto: "prefs_effort_auto",
  effortLow: "prefs_effort_low",
  effortMedium: "prefs_effort_medium",
  effortHigh: "prefs_effort_high",
  effortMax: "prefs_effort_max",
  current: "prefs_current",
} as const;

export type PrefKey = (typeof PREFS_KEYS)[keyof typeof PREFS_KEYS];

export const PREFS_LOCALES: Record<"zh" | "en" | "ja", Record<PrefKey, string>> = {
  zh: {
    prefs_hint: "↑↓ 选中 · 1..N 跳 · 回车选定",
    prefs_close: "Esc 关闭",
    prefs_accent_title: "强调色",
    prefs_theme_title: "主题",
    prefs_lang_title: "界面语言",
    prefs_effort_title: "思考强度",
    prefs_effort_auto: "自动（模型决定）",
    prefs_effort_low: "低（快但白搭）",
    prefs_effort_medium: "中",
    prefs_effort_high: "高（深度推演）",
    prefs_effort_max: "拉满（最慢、最详）",
    prefs_current: "当前",
  },
  en: {
    prefs_hint: "↑↓ select · 1..N jump · Enter pick",
    prefs_close: "Esc to close",
    prefs_accent_title: "Accent color",
    prefs_theme_title: "Theme",
    prefs_lang_title: "Interface language",
    prefs_effort_title: "Thinking depth",
    prefs_effort_auto: "Auto (model decides)",
    prefs_effort_low: "Low (fast)",
    prefs_effort_medium: "Medium",
    prefs_effort_high: "High (deep reasoning)",
    prefs_effort_max: "Max (slowest, most thorough)",
    prefs_current: "current",
  },
  ja: {
    prefs_hint: "↑↓ で選択 · 1..N でジャンプ · Enter で確定",
    prefs_close: "Esc で閉じる",
    prefs_accent_title: "アクセントカラー",
    prefs_theme_title: "テーマ",
    prefs_lang_title: "表示言語",
    prefs_effort_title: "思考の強さ",
    prefs_effort_auto: "自動（モデル任せ）",
    prefs_effort_low: "低（速い）",
    prefs_effort_medium: "中",
    prefs_effort_high: "高（深い推論）",
    prefs_effort_max: "最大（最も丁寧に）",
    prefs_current: "現在",
  },
};
