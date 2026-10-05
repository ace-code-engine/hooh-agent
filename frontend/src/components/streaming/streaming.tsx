/**
 * Streaming 层（React 件）：`StreamingMarkdown` / `SplitDiff` / `SearchBar`。
 * 纯逻辑去 `./render.ts`；这层只管作画，不掺决策。
 */

import { Box, Text, useInput } from "../../../vendor/dsh-ink/kernel.js";
import { diffSlot, type DiffSlot } from "../../render/diff.js";
import {
  type ColorFn,
  useColumns,
} from "../design-system/primitives.js";
import { STREAM_KEYS, type StreamKey } from "./i18n.js";

export interface StreamingMarkdownProps {
  readonly content: string;
  readonly width?: number;
  readonly color?: ColorFn;
}

/** 把一串 Markdown 渲成行序列（React 门外汉不回关 parse;它只把文本过一遍 Inline 就行） */
function mdLines(content: string): readonly string[] {
  return content.split("\n");
}

function MarkdownText({ text, color }: { text: string; color?: ColorFn }) {
  return <Text color={color?.("text")}>{text}</Text>;
}

export function StreamingMarkdown({ content, width, color }: StreamingMarkdownProps) {
  const cols = useColumns(width);
  const lines = mdLines(content);
  return (
    <Box flexDirection="column" width={cols}>
      {lines.map((l, i) => (
        <MarkdownText key={i} text={l} color={color} />
      ))}
    </Box>
  );
}

export interface SplitDiffProps {
  readonly lines: readonly string[];
  readonly width?: number;
  readonly color?: ColorFn;
}

const SLOT_COLOR: Record<DiffSlot, string> = {
  "+": "success", "-": "error", " ": "dim", "~": "info", "?": "warn",
};

/** 每行<槽位><空格><正文>（P2 的 DiffSlot 同配），左右联排只在宽 ≥ 100 时长。 */
function DiffRow({ slot, body, color }: {
  slot: DiffSlot; body: string; color?: ColorFn;
}) {
  return (
    <Box>
      <Text color={SLOT_COLOR[slot]}>{slot}</Text>
      <Text>{" "}</Text>
      <Text color={color?.(slot === "-" ? "dim" : "text")}>{body}</Text>
    </Box>
  );
}

export function SplitDiff({ lines, width, color }: SplitDiffProps) {
  const cols = useColumns(width);
  const wide = cols >= 100;
  const rows = lines.map((raw) => {
    const slot = diffSlot(raw);
    const body = slot === "+" || slot === "-" ? raw.slice(1) : raw;
    return { raw, slot, body };
  });
  if (!wide) {
    return (
      <Box flexDirection="column" width={cols}>
        {rows.map((r, i) => <DiffRow key={i} slot={r.slot} body={r.body} color={color} />)}
      </Box>
    );
  }
  const half = Math.floor(cols / 2) - 1;
  const left = rows.filter((r) => r.slot !== "+");
  const right = rows.filter((r) => r.slot !== "-" && r.slot !== "~" && r.slot !== "?");
  const maxH = Math.max(left.length, right.length);
  return (
    <Box flexDirection="row" width={cols}>
      <Box flexDirection="column" width={half}>
        {left.map((r, i) => <DiffRow key={i} slot={r.slot} body={r.body} color={color} />)}
        {Array.from({ length: maxH - left.length }, (_, i) => <Text key={`s${i}`} color={color?.("dim")}>{""}</Text>)}
      </Box>
      <Box width={1} />
      <Box flexDirection="column" width={half}>
        {right.map((r, i) => <DiffRow key={i} slot={r.slot} body={r.body} color={color} />)}
        {Array.from({ length: maxH - right.length }, (_, i) => <Text key={`s${i}`} color={color?.("dim")}>{""}</Text>)}
      </Box>
    </Box>
  );
}

export interface SearchBarProps {
  readonly query: string;
  readonly hits: number;
  readonly hitIndex?: number;
  readonly placeholder?: string;
  readonly onChange: (query: string) => void;
  readonly onFirst: () => void;
  readonly onClose: () => void;
  readonly t: (key: StreamKey, params?: Record<string, string | number>) => string;
  readonly width?: number;
  readonly color?: ColorFn;
}

export function SearchBar({
  query,
  hits,
  hitIndex = 0,
  placeholder,
  onChange,
  onFirst,
  onClose,
  t,
  width,
  color,
}: SearchBarProps) {
  const cols = useColumns(width);
  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) { onFirst(); return; }
    if (key.backspace || key.delete) { onChange(query.slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) {
      onChange(query + input);
    }
  });
  const ph = query || (placeholder ?? t(STREAM_KEYS.placeholder));
  const count = hits === 0 ? t(STREAM_KEYS.none) : `${hitIndex + 1}/${hits}`;
  return (
    <Box flexDirection="column" width={cols}>
      <Text color={color?.("text")}>
        <Text color={color?.("accent")}>{"› "}</Text>
        {ph}
      </Text>
      <Text color={color?.("dim")}>{count}</Text>
    </Box>
  );
}

export { STREAM_KEYS, STREAM_LOCALES, type StreamKey } from "./i18n.js";
