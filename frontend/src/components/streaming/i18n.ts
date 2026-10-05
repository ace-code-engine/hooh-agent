/**
 * `streaming/` 本地文案。
 */

export const STREAM_KEYS = {
  placeholder: "stream_search_placeholder",
  hint: "stream_search_hint",
  none: "stream_search_none",
} as const;

export type StreamKey = (typeof STREAM_KEYS)[keyof typeof STREAM_KEYS];

export const STREAM_LOCALES: Record<"zh" | "en" | "ja", Record<StreamKey, string>> = {
  zh: {
    stream_search_placeholder: "输入以过滤",
    stream_search_hint: "Enter 跳首个 · Esc 关闭",
    stream_search_none: "没有匹配项",
  },
  en: {
    stream_search_placeholder: "Type to filter",
    stream_search_hint: "Enter jumps to first · Esc closes",
    stream_search_none: "No matches",
  },
  ja: {
    stream_search_placeholder: "入力で絞り込む",
    stream_search_hint: "Enter で先頭へ · Esc で閉じる",
    stream_search_none: "一致する項目なし",
  },
};
