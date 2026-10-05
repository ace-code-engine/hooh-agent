/** `streaming/` 出口（design system 同口径：从这里走）。 */
export { StreamingMarkdown, SplitDiff, SearchBar } from "./streaming.js";
export type { StreamingMarkdownProps, SplitDiffProps, SearchBarProps } from "./streaming.js";
export { streamChunks, flushStream, diffRows, splitDiffColumns, type StreamWork, type DiffRenderRow } from "./render.js";
export { STREAM_KEYS, STREAM_LOCALES, type StreamKey } from "./i18n.js";
