/**
 * EffortBadge —— 照搬自 dsh-TUI EffortTierBadge 的档名聚拢徽标。
 *
 * 钉四件事：聚拢数学（起止两端 + 中途在动）、相位时间轴、
 * ACE_NO_ANIM 降级、渲染出来的字确实落在行中心附近。
 */

import React from 'react';
import { describe, expect, it } from 'vitest';

import { Box, Text } from '../vendor/dsh-ink/kernel.js';

import {
  badgePhase,
  badgeSpacing,
  EFFORT_BADGE_TIMELINE,
  EFFORT_BADGE_TOTAL_MS,
  EffortBadge,
} from '../src/components/EffortBadge.js';
import { renderLines } from './helpers/screen.js';

const noColor = (): string | undefined => undefined;
const W = 80;

describe('EffortBadge：聚拢数学（照搬 EffortTierBadge）', () => {
  it('起点 = 10 格间距，终点 = 1 格间距（Codex converge 语义）', () => {
    const start = badgeSpacing('HIGH', 0, W);
    const end = badgeSpacing('HIGH', EFFORT_BADGE_TIMELINE.convergeMs, W);
    expect(start.length).toBeGreaterThan(end.length);
    // 终点：相邻字母恰好隔 1 格（H I G H），整体锚在行中心附近
    expect(end.replace(/ /g, '').slice(0, 2)).toBe('HI');
    expect(end).toMatch(/^ {30,45}H I G H$/);
  });

  it('中途每帧至少有一个字母在动（逐字母独立取整，不是整体跳格）', () => {
    const a = badgeSpacing('HIGH', 100, W);
    const b = badgeSpacing('HIGH', 160, W);
    expect(a).not.toBe(b);
  });

  it('行中心为锚：奇数档名的居中字母原位不动', () => {
    // "MID"（3 字母）：聚拢完成后中字母在行中心
    const done = badgeSpacing('MID', EFFORT_BADGE_TIMELINE.convergeMs, W);
    const center = Math.round((W - 1) / 2);
    const midCol = done.indexOf('I', Math.floor(W / 2) - 4);
    expect(Math.abs(midCol - center)).toBeLessThanOrEqual(1);
  });
});

describe('EffortBadge：相位时间轴（一次性 ≤1.2s，§6 例外预算内）', () => {
  it('in → hold → fade → null', () => {
    expect(badgePhase(0)).toBe('in');
    expect(badgePhase(EFFORT_BADGE_TIMELINE.brightenMs)).toBe('in');
    expect(badgePhase(EFFORT_BADGE_TIMELINE.convergeMs + 10)).toBe('hold');
    expect(badgePhase(EFFORT_BADGE_TIMELINE.convergeMs + EFFORT_BADGE_TIMELINE.holdMs + 10))
      .toBe('fade');
    expect(badgePhase(EFFORT_BADGE_TOTAL_MS)).toBeNull();
  });

  it('总长不超过揭幕例外的 1.2s 预算', () => {
    expect(EFFORT_BADGE_TOTAL_MS).toBeLessThanOrEqual(1200);
  });
});

describe('EffortBadge：渲染', () => {
  const render = (elapsedMs: number | undefined, env?: string): string => {
    const prev = env !== undefined ? process.env.ACE_NO_ANIM : process.env.ACE_NO_ANIM;
    if (env !== undefined) process.env.ACE_NO_ANIM = env;
    try {
      // 哨兵行包裹：徽标不渲染时帧里只有哨兵——helper 对「0 行」会当护栏异常抛。
      const frame = renderLines(
        React.createElement(
          Box,
          { flexDirection: 'column' },
          React.createElement(Text, null, '[X]'),
          React.createElement(EffortBadge, {
            label: 'high', columns: W, color: noColor, elapsedMs,
          }),
        ),
        W,
      ).text;
      return frame.replace(/^\[X\]\n?/, '').trimEnd();
    } finally {
      if (env !== undefined) {
        if (prev === undefined) delete process.env.ACE_NO_ANIM;
        else process.env.ACE_NO_ANIM = prev;
      }
    }
  };

  it('hold 相位：档名大写、居中、聚拢完成（1 格间距）', () => {
    const f = render(EFFORT_BADGE_TIMELINE.convergeMs + 50);
    expect(f).toContain('H I G H');
  });

  it('ACE_NO_ANIM=1 → 整个不渲染（降级是显式选择）', () => {
    expect(render(0, '1')).toBe('');
  });

  it('播完（elapsed ≥ 总长）→ 不渲染', () => {
    expect(render(EFFORT_BADGE_TOTAL_MS + 10)).toBe('');
  });
});
