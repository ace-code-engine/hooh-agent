/**
 * Streaming 层（借鉴 dsh-TUI `StreamingMarkdown` / `SplitDiffView` / `SearchBox`）：
 * - 流式：按行界出帧；不完整行不进屏，flush() 兜底。
 * - 左右联排 diff：宽屏并排，窄屏退化单列；槽位与颜色**我们 P2 已定了**（`DiffSlot`）。
 * - 通用搜索外壳。
 */

// ──────────────────────────────────── 流式 Markdown（非 React，一算一喂的势）

export interface StreamWork {
  /** 还没成形的尾巴；flush() 时它是最后的内容。 */
  trailing: string;
  /** 已经稳态的行（行界完成的新鲜度）。 */
  committed: readonly string[];
}

/**
 * 追加一段增量 → 只输出**完整行**，半行留尾巴。
 * 这个函数一帧一行（不趁界去前后挪）——流式转录的"顺序就是时间序"就靠它撑住。
 */
export function streamChunks(delta: string, work: StreamWork): { flushed: string[]; work: StreamWork } {
  const trailing = work.trailing + delta;
  const parts = trailing.split("\n");
  return {
    flushed: parts.slice(0, -1),
    work: { trailing: parts[parts.length - 1], committed: [...work.committed, ...parts.slice(0, -1)] },
  };
}

/** 收尾：把尾巴那半行也收进来。 */
export function flushStream(work: StreamWork): { flushed: string[]; work: StreamWork } {
  if (!work.trailing) return { flushed: [], work };
  return { flushed: [work.trailing], work: { trailing: "", committed: [...work.committed, work.trailing] } };
}


// ──────────────────────────────────── SplitDiff（宽联排/窄单列）
// 槽位定义照 P2 定的：'+' / '-' / ' ' 是 diff 正文，'~' 块头，'?' 不是 diff 行（文件头/编不来）。

import { diffSlot, type DiffSlot, type DiffToken } from "../../render/diff.js";

export interface DiffRenderRow {
  readonly slot: DiffSlot;
  readonly body: string;
  readonly tone: DiffToken;
}

/** 原始 diff 行 → 状态槽 + 正文（不编"第几行"）。 */
export function diffRows(lines: readonly string[]): DiffRenderRow[] {
  return lines.map((line) => {
    const slot = diffSlot(line);
    const body = slot === "+" || slot === "-" ? line.slice(1) : line;
    const tone: DiffToken = slot === "+" ? "success" : slot === "-" ? "error" : slot === " " ? "dim" : "info";
    return { slot, body, tone };
  });
}

/** 联排：宽 ≥ 100 时左右分栏，否则单列（文件头不重复）。 */
export function splitDiffColumns(
  lines: readonly string[],
  width: number,
): { left: readonly string[]; right: readonly string[]; pair: boolean } {
  if (width < 100) return { left: lines, right: [], pair: false };
  const left: string[] = [];
  const right: string[] = [];
  for (const line of lines) {
    const slot = diffSlot(line);
    // '~' 块头与 '?' 文件头只去左栏；'+/-' 两边，' ' 右栏（已有代码）
    if (slot === "~" || slot === "?") { if (!left.length || left[left.length - 1] !== line) left.push(line); } else if (slot === "+") { right.push(line); } else if (slot === "-") { left.push(line); } else { left.push(line); right.push(line); }
  }
  return { left, right, pair: right.length > 0 };
}
