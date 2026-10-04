/**
 * 等待指示器 —— 一轮跑动期间唯一在动的东西。
 *
 * 为什么它重要：没有它，界面在等待时**是死的**。用户分不清"它在想"和"它挂了"，
 * 而这两者的后续动作完全相反（等 vs 中断）。Python 侧同样有这个问题，
 * 而且它还有一个更糟的版本 —— 全屏路径下 spinner 的输出被整个丢掉，界面直接冻结。
 *
 * 动词按**阶段**选，而不是随机轮换：`waiting` 配"连接"、`reasoning` 配"思考"，
 * 随机轮换会让"现在到底卡在哪一步"这条信息消失。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React, { useEffect, useState } from 'react';

import { gstr } from '../render/glyphs.js';
import { g } from '../render/glyphs.js';
import { frameAt, phaseInterval, stallLevel, type Phase } from '../render/spinner.js';

export interface SpinnerProps {
  phase: Phase | string;
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  /** 无动效：恒取第一帧。前庭敏感的用户用这个。 */
  reducedMotion?: boolean;
  /** 起始时刻（毫秒）。测试可以注入固定值。 */
  startedAt?: number;
  /** 引擎最后一次产出的时刻（秒，取事件 `ts`）。0 = 本轮还没产出。缺省不判卡住（R-7）。 */
  lastOutputAt?: number;
}

/** 阶段 → 动词序号（`spin_verb_1..5`）。一一对应，稳定可断言。 */
export const PHASE_VERB: Record<string, number> = {
  waiting: 1,
  reasoning: 2,
  answering: 3,
  tool_args: 4,
  tool_running: 5,
};

/**
 * 思考阶段前面那个**标记**（照 Claude Code `AssistantThinkingMessage` 的 `∴ Thinking`）。
 * 只给「在想」的阶段加：工具参数解析、纯等待不该长成「思考」的样子。
 */
export function phaseMark(phase: string | undefined): string {
  return String(phase) === 'reasoning' ? `${g('∴')} ` : '';
}

export function verbKeyFor(phase: string | undefined): string {
  const n = PHASE_VERB[String(phase)] ?? 2;
  return `spin_verb_${n}`;
}

export function Spinner({
  phase,
  t,
  color,
  reducedMotion = false,
  startedAt,
  lastOutputAt = 0,
}: SpinnerProps): React.ReactElement {
  const [elapsed, setElapsed] = useState(0);
  const [idle, setIdle] = useState(0);
  const start = React.useRef(startedAt ?? Date.now());

  useEffect(() => {
    // 帧间隔本身就是"多久动一下"，所以定时器跟着它走：慢阶段不必每秒醒 12 次。
    const ms = Math.max(50, Math.round(phaseInterval(phase) * 1000));
    const id = setInterval(() => {
      const now = Date.now();
      const secs = (now - start.current) / 1000;
      setElapsed(secs);
      // idle = 距引擎上一次产出的秒数。还没产出过（lastOutputAt=0）时 = 本轮已过时长。
      setIdle(lastOutputAt > 0 ? Math.max(0, now / 1000 - lastOutputAt) : secs);
    }, ms);
    return () => clearInterval(id);
  }, [phase, lastOutputAt]);

  // 过 `g()`：cp936 下 `◐◓◑◒` 印不出来，spinner 会变成一串乱码
  const glyph = gstr(frameAt(phase, elapsed, reducedMotion));
  const secs = Math.floor(elapsed);
  // 卡住判定（R-7）：工具在跑时不判 —— 一条长命令跑 60 秒是正常的，把它染成告警色
  // 只会教用户忽略颜色（`ui/ace_spinner.spinner_line` 的 `active_tool` 同一条理由）。
  // Ink 用**阶梯**（warn）而非平滑插值 —— 同一语义，各壳渲染（`THREE-LAYERS` N-1）。
  const stalled = phase !== 'tool_running' && stallLevel(idle) > 0;
  const stallColor = color('warn');

  return (
    <Box>
      <Text color={stalled && !reducedMotion ? stallColor : color('accent')}>{glyph} </Text>
      <Text color={stalled && !reducedMotion ? stallColor : color('dim')}>{phaseMark(phase)}{t(verbKeyFor(phase))}</Text>
      {secs > 0 ? (
        <Text color={stalled && !reducedMotion ? stallColor : color('dim')}>
          {' '}
          {t('spin_elapsed', { secs })}
        </Text>
      ) : null}
      {/* 无动效：用文字编码代替颜色动画（静态也能看出"卡了"） —— 与 Python 同一条出口 */}
      {stalled && reducedMotion ? <Text color={stallColor}> {t('spin_stalled')}</Text> : null}
    </Box>
  );
}
