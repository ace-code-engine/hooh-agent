/**
 * **首屏吉祥物**：噪声圆盘（见 `render/noise-circle.ts`）。
 *
 * 为什么首屏要有这么一块：上游的首屏是"**左边一个图形 + 右边大字标题**"
 * （`Whale.tsx` + `DEEPSEEK HARNESS`），那是把 TUI 当 GUI 在做 —— 一屏进去先看见
 * 一个**画出来的东西**，而不是几行字。我们此前只有块字 logo。
 *
 * 行为：
 * - 挂载后**一次性**填满（0 → 满盘），末帧**留着**当静态吉祥物（不是转完就消失）；
 * - 这是"揭幕"，不是 spinner：不循环（规范 §6 给开屏开的那条例外就是"一次性、不循环"）；
 * - `reducedMotion` 或非交互环境 → 直接画满盘，一帧都不动。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React, { useEffect, useMemo, useState } from 'react';

import { DISC_COLS, DISC_ROWS, discFrames } from '../render/noise-circle.js';

export interface NoiseDiscProps {
  color: (token: string) => string | undefined;
  rows?: number;
  cols?: number;
  /** 无动效：直接满盘。前庭敏感的用户不该被迫看一段生长动画。 */
  reducedMotion?: boolean;
  /** 每帧间隔（毫秒）。默认 90 —— 6 帧 ≈ 0.5s，起手不拖沓。 */
  intervalMs?: number;
  /** 测试注入固定帧号（不传则自己走定时器）。 */
  frameIndex?: number;
}

export function NoiseDisc({
  color,
  rows = DISC_ROWS,
  cols = DISC_COLS,
  reducedMotion = false,
  intervalMs = 90,
  frameIndex,
}: NoiseDiscProps): React.ReactElement {
  // 正向帧 + 末帧满盘：`reverse: false` —— 吉祥物停在满盘，消散是开屏（Python 侧）的事。
  const frames = useMemo(() => discFrames({ cols, rows, steps: 6 }), [cols, rows]);
  const last = frames.length - 1;
  const [i, setI] = useState(reducedMotion ? last : 0);

  useEffect(() => {
    if (reducedMotion || frameIndex !== undefined) return;
    let cur = 0;
    const id = setInterval(() => {
      cur += 1;
      if (cur >= frames.length) {
        clearInterval(id);        // 一次性：填满就停，不循环
        setI(last);
        return;
      }
      setI(cur);
    }, Math.max(30, intervalMs));
    return () => clearInterval(id);
  }, [frames, reducedMotion, intervalMs, frameIndex, last]);

  const shown = frameIndex !== undefined ? frameIndex : i;
  const frame = frames[Math.max(0, Math.min(last, shown))] ?? [];

  return (
    <Box flexDirection="column">
      {frame.map((line, k) => (
        <Text key={k} color={color('accent')}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
