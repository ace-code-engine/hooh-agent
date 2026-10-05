/**
 * 上下文用量条 —— 借 `ContextBarView.js` 的**口径**，不借它的实现：
 *
 *   - 上游（`lib/types/components/ContextBarView.js:23-49`）用多段 `backgroundColor` 色块
 *     拼条、空余段右对齐塞读数 —— 那是**莫兰迪多色分段**，本仓库规范（K3 §必须拒绝 #6）
 *     明确拒收，且"一格内混两种背景色"是踩过的脏画。
 *   - 这里用 design-system 的 `ProgressBar`（八分之一块 `▏▎▍▌▋▊▉█`）：**一个格子只有一个
 *     字符**（要么整格满、要么是同一个七分数块字符），不存在半格两色。
 *   - 不变量：输出行的**显示宽度恒等于 `width`**（bar + 定宽右对齐读数 + 间隙补齐），
 *     `used` 超界被钳到 `[0, total]`（借 `ActivityLine.js:16-22` 的 occupied 归一思路；
 *     上游那里不算钳位，负数会得出负百分比）。
 *   - 没数据（`total` 非正或 `used` 不是数）→ 明确的空态文案，**不编数字**。
 */

import { Box, Text } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { ProgressBar, useColumns, type ColorFn } from '../design-system/index.js';
import { displayWidth } from '../../render/text.js';
import { USAGE_KEYS } from './i18n.js';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface ContextBarProps {
  /** 已占用 token；非有限数当没数据。 */
  used?: number | null;
  /** 上下文窗口总长；<=0 当没数据。 */
  total?: number | null;
  t: Translate;
  color?: ColorFn;
  /** 行宽（列）；缺省走 `TerminalSizeContext` 再缺 80。 */
  width?: number;
}

export function ContextBar({ used, total, t, color, width }: ContextBarProps): React.ReactElement {
  const cols = Math.max(2, useColumns(width));
  const ok =
    typeof total === 'number' && Number.isFinite(total) && total > 0 &&
    typeof used === 'number' && Number.isFinite(used);
  if (!ok) {
    return <Text color={color?.('dim')} wrap="truncate">{t(USAGE_KEYS.ctxEmpty)}</Text>;
  }
  const tTotal = total as number;
  const u = Math.min(Math.max(0, used as number), tTotal);
  const pct = Math.round((u / tTotal) * 100);
  const readout = `${t(USAGE_KEYS.ctxReadout, { used: u, total: tTotal })} · ${t(USAGE_KEYS.ctxPct, { pct })}`;
  const rw = displayWidth(readout);
  // 读数放得下就留 1 列间隙、其余全给 bar；放不下就按规范 §2 的优先级**丢读数**（bar 是主信息），
  // bar 占满整行 —— 两种情形下行宽都恒等于 `cols`。
  const withReadout = rw + 2 <= cols;
  const barWidth = withReadout ? Math.max(1, cols - rw - 1) : cols;
  const gap = ' '.repeat(Math.max(1, cols - barWidth - rw));
  return (
    <Box flexDirection="row" width={cols}>
      <ProgressBar ratio={u / tTotal} width={barWidth} color={color} />
      {withReadout ? (
        <Text color={color?.(pct >= 95 ? 'error' : pct >= 80 ? 'warn' : 'dim')}>{`${gap}${readout}`}</Text>
      ) : null}
    </Box>
  );
}
