/**
 * Token 用量表 —— `/stats` 的明细面。
 *
 * 借鉴 `BalanceReportRow.js:73-89` 的**分组口径**（上游把主会话与 subagent 各按
 * 自身模型分组、无法计价的只报 token），落到 ace 这边就是一张"按模型/类别一行"的表：
 *
 *   - 列 = 模型(左对齐, 超长按显示宽度截断) + 输入/输出/合计(右对齐定宽)；
 *     数字列宽 = 表头与各行数字的**显示宽度最大值**，全列对齐不掉队。
 *   - 表宽 > 终端列宽时只牺牲标签列，数字列不动（规范 §2：数值列是主信息）。
 *   - 行防御（`normalizeRows`）：引擎丢来什么形状都先过一遍，坏行丢弃而不是
 *     编一个 0 —— 看不到一行比看到一个错误的 0 强。
 *   - 空态：一行明确文案（ace 无 `/cost` 余额接口的同款口径：能拿就拿，没有就说没有）。
 */

import { Box, Text } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { useColumns, type ColorFn } from '../design-system/index.js';
import { displayWidth, padWidth, truncateWidth } from '../../render/text.js';
import { USAGE_KEYS } from './i18n.js';
import type { Translate } from './ContextBar.js';

export interface UsageRow {
  readonly label: string;
  readonly input: number;
  readonly output: number;
}

/** 防御性归一：只收 label 是字符串、input/output 是有限数的行。 */
export function normalizeRows(data: unknown): UsageRow[] {
  if (!Array.isArray(data)) return [];
  const out: UsageRow[] = [];
  for (const row of data) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const input = r['input'];
    const output = r['output'];
    if (typeof r['label'] !== 'string' || r['label'].trim() === '') continue;
    if (typeof input !== 'number' || !Number.isFinite(input)) continue;
    if (typeof output !== 'number' || !Number.isFinite(output)) continue;
    out.push({ label: r['label'], input, output });
  }
  return out;
}

/** token 数 → 短读数（`128000` → `128k`）；千位分隔符在窄表里反而是噪音。 */
export function fmtTokens(n: number): string {
  const v = Math.max(0, Math.trunc(n));
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1_000)}k`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/** 右对齐到 `w` 列（显示宽度）。 */
function rightAlign(text: string, w: number): string {
  return ' '.repeat(Math.max(0, w - displayWidth(text))) + text;
}

export interface UsageTableProps {
  rows?: unknown;
  t: Translate;
  color?: ColorFn;
  width?: number;
}

export function UsageTable({
  rows,
  t,
  color,
  width,
}: UsageTableProps): React.ReactElement {
  const cols = Math.max(4, useColumns(width));
  const data = React.useMemo(() => normalizeRows(rows), [rows]);
  if (data.length === 0) {
    return <Text color={color?.('dim')} wrap="truncate">{t(USAGE_KEYS.tblEmpty)}</Text>;
  }

  // 数字列宽：表头与数据取最大值。
  const headers = [t(USAGE_KEYS.tblInput), t(USAGE_KEYS.tblOutput), t(USAGE_KEYS.tblTotal)];
  const nums = data.map((r) => [fmtTokens(r.input), fmtTokens(r.output), fmtTokens(r.input + r.output)]);
  const colW = [0, 1, 2].map((i) =>
    Math.max(displayWidth(headers[i] ?? ''), ...nums.map((n) => displayWidth(n[i] ?? ''))),
  );
  const numBlockW = colW[0]! + colW[1]! + colW[2]! + 4; // 数字列之间各 2 空格（label↔数字之间没有）
  // 标签列吃掉剩余宽度；至少 4 列，放不下就硬截（数字列永不让位）。
  // labelW + numBlockW === cols：整行**显示宽度恒定**，数字列右缘钉在右边距上。
  const labelW = Math.max(4, cols - numBlockW);

  const line = (label: string, n: readonly [string, string, string]): string =>
    `${padWidth(truncateWidth(label, labelW), labelW)}${rightAlign(n[0], colW[0]!)}  ${rightAlign(n[1], colW[1]!)}  ${rightAlign(n[2], colW[2]!)}`;

  return (
    <Box flexDirection="column" width={cols}>
      <Text color={color?.('dim')} wrap="truncate">
        {line(t(USAGE_KEYS.tblModel), headers as [string, string, string])}
      </Text>
      {data.map((r, i) => (
        <Text key={`${r.label}:${i}`} wrap="truncate">
          {line(r.label, nums[i] as [string, string, string])}
        </Text>
      ))}
    </Box>
  );
}
