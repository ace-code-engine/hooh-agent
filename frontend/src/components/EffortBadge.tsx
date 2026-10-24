/**
 * EffortBadge —— 切换思考强度时在输入行上方浮现的**档名聚拢徽标**。
 *
 * 照搬自 dsh-TUI 的 `EffortTierBadge`（frontend/dsh-ui/components/，用户点名要的
 * 那个「小模式」）：档名以大写出现在行中心，字母间距从 10 格**减速聚拢**到 1 格，
 * 随后渐隐让位。聚拢数学逐行照搬——行中心为锚、左右字母镜像落列（`2C − col`），
 * 90% 线性 + 10% easeOutQuad 的轻缓收尾（纯 ease-out 在离散格子上会末段长停顿，
 * 观感是卡顿——上游踩过的坑直接继承结论）。
 *
 * 与上游的三点不同，都有理由：
 * 1. **每次切档都出徽标**，不只切进最高档——上游的三幕点焰只在进顶档时点燃，
 *    用户要的是「切换时的反馈」这个通用语义；顶档专属的 ❯ 充能与边框扫光不在本件。
 * 2. **颜色走主题 token 不做 RGB 混合**：上游把亮蓝混向底色模拟 alpha；本仓库
 *    主题是 ANSI 名 + 雾蓝 hex 混合体，硬混 RGB 会在基础主题下失真。改用
 *    SGR 两态表达（入场 dim → hold 亮/accent 加粗 → fade 回 dim），规则天然成立。
 * 3. **时钟用组件内 interval**（仅动画窗口活着，播完即清）而不是内核共享时钟
 *    ——ace 前端的渲染路径没挂 ClockContext，自备时钟少一层接线。
 *
 * 瑞士规范口径：一次性过场（≤1.2s、不循环），与 §6 开场揭幕同一档例外；
 * `ACE_NO_ANIM=1` / `ACE_REDUCE_MOTION=1` 时整个不渲染（降级是显式选择）。
 */

import React, { useEffect, useRef, useState } from 'react';

import { Text } from '../../vendor/dsh-ink/kernel.js';

/** 字母间距聚拢：起点 10 格 → 终点 1 格（Codex 的 converge 语义）。 */
export const GAP_START = 10;
export const GAP_END = 1;
/** 时间轴（ms）：聚拢 → 停留 → 渐隐。总长 ≤1.2s（§6 例外预算内）。 */
export const EFFORT_BADGE_TIMELINE = {
  convergeMs: 500,
  brightenMs: 200,
  holdMs: 400,
  fadeMs: 300,
} as const;
export const EFFORT_BADGE_TOTAL_MS =
  EFFORT_BADGE_TIMELINE.convergeMs + EFFORT_BADGE_TIMELINE.holdMs + EFFORT_BADGE_TIMELINE.fadeMs;
const TICK_MS = 60;

export type BadgePhase = 'in' | 'hold' | 'fade' | null;

/** 按已历时长取相位；`null` = 动画已结束（调用方该卸载了）。 */
export function badgePhase(elapsedMs: number): BadgePhase {
  if (elapsedMs < 0) return null;
  const { convergeMs, holdMs, fadeMs } = EFFORT_BADGE_TIMELINE;
  if (elapsedMs < convergeMs) return 'in';
  if (elapsedMs < convergeMs + holdMs) return 'hold';
  if (elapsedMs < convergeMs + holdMs + fadeMs) return 'fade';
  return null;
}

/**
 * 聚拢中的档名文本：行中心锚、左右镜像落列、逐字母独立取整
 * （不同字母在不同帧跨格，每帧至少一个在动——把间距整体取整会卡）。
 * 聚拢完成后稳定在 1 格间距。`columns` 是可用行宽。
 */
export function badgeSpacing(label: string, elapsedMs: number, columns: number): string {
  const progress = Math.min(1, Math.max(0, elapsedMs / EFFORT_BADGE_TIMELINE.convergeMs));
  const eased = 1 - progress;
  // 90% 线性 + 10% easeOutQuad：跳变间隔全程近似恒定，仅末端轻微放慢。
  const easedWithFloor = 0.9 * eased + 0.1 * (1 - progress * progress);
  const gapF = GAP_END + (GAP_START - GAP_END) * easedWithFloor;
  const C = Math.round((columns - 1) / 2);
  let spaced = '';
  let column = 0;
  for (let i = 0; i < label.length; i++) {
    const off = (i - (label.length - 1) / 2) * (1 + gapF);
    const at =
      off >= 0
        ? Math.round(C + off)
        : 2 * C - Math.round(C - off);
    spaced += ' '.repeat(Math.max(0, at - column)) + label[i]!;
    column = at + 1;
  }
  return spaced;
}

export function EffortBadge({
  label,
  columns,
  color,
  noAnim = false,
  elapsedMs: elapsedProp,
  onDone,
}: {
  /** 档名（原值即可——渲染时统一大写，与上游同口径）。 */
  label: string;
  /** 可用行宽（App 的 `content`）。 */
  columns: number;
  /** 上色函数（App 的 `colorOf`）：token → ANSI 串。 */
  color: (token: string) => string | undefined;
  /** 测试注入的已历时钟；给了就**纯函数渲染**，不起定时器。 */
  elapsedMs?: number;
  noAnim?: boolean;
  onDone?: () => void;
}): React.ReactNode {
  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(false);
  const injected = elapsedProp !== undefined;
  const at = injected ? elapsedProp : elapsed;

  const animOn = !noAnim &&
    process.env.ACE_NO_ANIM !== '1' && process.env.ACE_REDUCE_MOTION !== '1';
  const phase = animOn ? badgePhase(at) : null;

  // 仅动画窗口起定时器；播完清掉并上抛 onDone（父组件据此卸载）。
  useEffect(() => {
    if (injected || !animOn || phase === null) return;
    const id = setInterval(() => setElapsed((e) => e + TICK_MS), TICK_MS);
    return () => clearInterval(id);
  }, [injected, animOn, phase === null]);
  useEffect(() => {
    if (phase !== null || doneRef.current) return;
    doneRef.current = true;
    onDone?.();
  }, [phase, onDone]);

  if (!animOn || phase === null) return null;
  const spaced = badgeSpacing(label.toUpperCase(), at, columns);
  const tone =
    phase === 'hold' ? { bold: true, token: 'accent' as const } : { bold: false, token: 'dim' as const };
  return (
    <Text bold={tone.bold} color={color(tone.token)} wrap="truncate-end">
      {spaced}
    </Text>
  );
}
