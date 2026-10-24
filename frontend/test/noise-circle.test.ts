/**
 * **噪声圆盘**（首屏那个图形）的断言 —— 结构性质，不是逐帧字节。
 *
 * 为什么不和 Python 那份逐帧比对：两边的 `Math.sin`/`math.sin` 末位可能不同，
 * 而那个差别**看不见**（阈值只关心排名）。要钉的是这几条**看得出**的性质：
 * 确定性、圆形（四角空）、成团、填/倒放对称。
 */

import { describe, expect, it } from 'vitest';

import { DISC_COLS, DISC_ROWS, RAMP, discFrames, birthThresholds } from '../src/render/noise-circle.js';

const lit = (frame: string[]): number =>
  frame.reduce((n, line) => n + [...line].filter((c) => c !== ' ').length, 0);

describe('噪声圆盘 · 纯逻辑', () => {
  it('尺寸就是给的网格（多行图形，不是一行进度条）', () => {
    const f = discFrames({ cols: 20, rows: 10, steps: 4 })[0]!;
    expect(f).toHaveLength(10);
    for (const line of f) expect([...line]).toHaveLength(20);
  });

  it('**是圆不是方**：四角永远是空的', () => {
    const grid = birthThresholds(DISC_COLS, DISC_ROWS);
    for (const [j, i] of [[0, 0], [0, DISC_COLS - 1], [DISC_ROWS - 1, 0], [DISC_ROWS - 1, DISC_COLS - 1]]) {
      expect(grid[j]![i], `(${i},${j}) 不该在圆内`).toBeNull();
    }
    // 圆心附近一定在圆内（否则"空"就不能证明是圆）
    expect(grid[Math.floor(DISC_ROWS / 2)]![Math.floor(DISC_COLS / 2)]).not.toBeNull();
  });

  it('阈值在 [0,1] 且**各不相同**（排名归一 ⇒ 阈值就是已填比例）', () => {
    const grid = birthThresholds(DISC_COLS, DISC_ROWS);
    const vals = grid.flat().filter((v): v is number => v !== null);
    expect(vals.length).toBeGreaterThan(20);
    expect(Math.min(...vals)).toBe(0);
    expect(Math.max(...vals)).toBe(1);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('填满 → 末帧是满盘；接上倒放 → 中间满、两头空且**对称**', () => {
    const fwd = discFrames({ steps: 4 });
    expect(lit(fwd[fwd.length - 1]!)).toBe(Math.max(...fwd.map(lit)));
    const rev = discFrames({ steps: 4, reverse: true });
    const counts = rev.map(lit);
    expect(counts).toEqual([...counts].reverse());          // 对称（填 / 倒放）
    expect(counts[(counts.length - 1) / 2]).toBe(Math.max(...counts));
  });

  it('确定性：同参数逐帧相同（`SEED` 写死，不是每次启动换一张图）', () => {
    expect(discFrames({ steps: 5, reverse: true })).toEqual(discFrames({ steps: 5, reverse: true }));
  });

  it('只画 ramp 里的字形（没有意外字符），且**成团**（不是散点雨）', () => {
    const frames = discFrames({ steps: 6, reverse: true });
    const chars = new Set(frames.flat().flatMap((l) => [...l]).filter((c) => c !== ' '));
    for (const ch of chars) expect(RAMP).toContain(ch);

    // 第一帧只有少数几格亮，且它们**相邻**（随机出生顺序会长成孤立的散点）。
    const first = frames.find((f) => lit(f) >= 3) ?? frames[1]!;
    const on = first.flatMap((line, j) => [...line].map((c, i) => (c !== ' ' ? `${i},${j}` : '')))
      .filter(Boolean);
    const touching = on.some((a) =>
      on.some((b) => {
        const [ai, aj] = a.split(',').map(Number);
        const [bi, bj] = b.split(',').map(Number);
        return (ai === bi && Math.abs(aj - bj!) === 1) || (aj === bj && Math.abs(ai - bi!) === 1);
      }));
    expect(touching, '前几格应当是连着的（成团生长）').toBe(true);
  });
});
