/**
 * 等待指示器测试 —— 重点是**与 Python 侧逐条一致**。
 *
 * 为什么字形与速度必须一致：`ui/ace_spinner.py` 的注释写着「**速度本身是语义**」——
 * `waiting` 0.08s（等首字节，网络在动）、`reasoning` 0.24s（模型在推）、
 * `tool_running` 0.16s（工具在跑）。用户看速度判断"卡在哪一步"。
 * 两套前端各转各的，这条信息就废了。所以这里直接读那个 .py 比对。
 *
 * ## 迁移记录（S5，换内核）
 * 只有末尾两条渲染用例要挂载：卡住判定来自 `useEffect` + `setInterval`（要等帧间隔
 * 走一拍才会 setState），所以走 `./mount.js` 的 `mountTree()`（内核 `renderSync` + 假 stdio）
 * —— `renderLines` 是一次性渲染，那颗定时器根本没机会跑。断言与 `tick(320ms)` 一字未改。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { describe, expect, it } from 'vitest';

import { Spinner } from '../src/components/Spinner.js';
import {
  DEFAULT_PHASE,
  GLYPHS,
  PHASES,
  STALL_SECONDS,
  frameAt,
  framesFor,
  phaseInterval,
  stallLevel,
} from '../src/render/spinner.js';
import { PHASE_VERB, verbKeyFor } from '../src/components/Spinner.js';
import { displayWidth } from '../src/render/text.js';
import { mountTree } from './mount.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PyGlyph {
  frames: string[];
  interval: number;
}

function pythonGlyphs(): { phases: string[]; default: string; glyphs: Record<string, PyGlyph> } {
  const src = readFileSync(join(ROOT, 'ui', 'ace_spinner.py'), 'utf-8');

  // 注意：那行带类型注解（`PHASES: Tuple[str, ...] = (...)`），所以 `PHASES\s*=` 匹配不到。
  // 写成 `PHASES[^=\n]*=` 才稳。
  const phases = [
    ...(src.match(/PHASES[^=\n]*=\s*\(([^)]*)\)/)?.[1] ?? '').matchAll(/"(\w+)"/g),
  ].map((m) => m[1]!);
  const def = src.match(/DEFAULT_PHASE[^=\n]*=\s*"(\w+)"/)?.[1] ?? '';

  const block = src.match(/_GLYPHS[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const glyphs: Record<string, PyGlyph> = {};
  for (const m of block.matchAll(/"(\w+)":\s*\(\(([^)]*)\),\s*([\d.]+)\)/g)) {
    const frames = [...m[2]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
    glyphs[m[1]!] = { frames, interval: Number(m[3]!) };
  }
  return { phases, default: def, glyphs };
}

describe('与 ui/ace_spinner.py 一致', () => {
  const py = pythonGlyphs();

  it('阶段集合相同', () => {
    expect(py.phases.length).toBe(5);
    expect([...PHASES].sort()).toEqual([...py.phases].sort());
  });

  it('默认阶段相同', () => {
    expect(py.default).toBe(DEFAULT_PHASE);
  });

  it('**每个阶段的字形序列与帧间隔都逐条相同**', () => {
    // 先确认真的抓到了东西：抓不到时下面的循环一次都不进，这条会**空转通过** ——
    // 而这正是它要防的那类假绿。
    expect(py.phases.length, '从 .py 里没抓到阶段，下面的比对是空转的').toBe(5);
    expect(Object.keys(py.glyphs).length, '从 .py 里没抓到字形表').toBe(5);
    for (const phase of py.phases) {
      const mine = GLYPHS[phase as keyof typeof GLYPHS];
      expect(mine, `缺阶段 ${phase}`).toBeDefined();
      expect(mine.frames, `${phase} 字形`).toEqual(py.glyphs[phase]!.frames);
      expect(mine.interval, `${phase} 帧间隔`).toBeCloseTo(py.glyphs[phase]!.interval, 5);
    }
  });

  it('字形都是单宽、无 emoji（旧终端里 emoji 会画成方框）', () => {
    for (const phase of PHASES) {
      for (const f of GLYPHS[phase].frames) {
        // 注意是**逐字符**：一帧现在可以是多格（推理那串噪声填充是 5 格）。
        for (const ch of [...f]) {
          expect(displayWidth(ch), `${phase}/${f} 里的 ${ch}`).toBe(1);
          expect(ch.codePointAt(0)!, `${phase}/${f} 里的 ${ch} 不该是 emoji`).toBeLessThan(0x1f000);
        }
      }
    }
  });

  it('★推理帧是**噪声填充**：空 → 满 → 倒放回空（用户给的参考件那套算法）', () => {
    const frames = GLYPHS.reasoning.frames;
    const mid = (frames.length - 1) / 2;
    expect(frames[0]).toBe('·····');                       // 起手是空的
    expect(frames[mid]).toBe('█████');                     // 最长的那一帧 = 填满
    expect(frames[frames.length - 1]).toBe('·····');       // 收尾也回到空
    // **倒放**：后半段就是前半段的镜像（填满之后往回走，不是继续往前冲）
    for (let i = 1; i <= mid; i++) {
      expect(frames[frames.length - 1 - i], `倒放第 ${i} 帧`).toBe(frames[i]);
    }
    // 只出现过"满"和"空"两种格子状态（源片是二值填充，不是灰度）
    const chars = new Set(frames.join(''));
    expect([...chars].sort()).toEqual(['·', '█']);
  });
});

describe('帧推进', () => {
  it('按帧间隔推进（推理现在是噪声填充，11 帧一轮）', () => {
    expect(frameAt('reasoning', 0)).toBe('·····');
    expect(frameAt('reasoning', 0.18)).toBe('·····');      // 第 2 帧仍是空的
    expect(frameAt('reasoning', 0.36)).toBe('···██');      // 开始长
    expect(frameAt('reasoning', 0.18 * 4)).toBe('█████');  // 填满
    expect(frameAt('reasoning', 0.18 * 11)).toBe('·····'); // 一轮走完回到起手
  });

  it('不同阶段速度不同（这是语义，不是装饰）', () => {
    expect(phaseInterval('waiting')).toBeLessThan(phaseInterval('tool_running'));
    expect(phaseInterval('tool_running')).toBeLessThan(phaseInterval('reasoning'));
  });

  it('**无动效时恒取一个固定帧** —— 降级要降到底，只慢一半同样难受', () => {
    for (const t of [0, 0.5, 10, 999]) {
      // 推理那个阶段特殊：填充动画的首帧是空格子，静态时会像"没在干活"，
      // 所以无动效给它**填满**那一帧（Python 侧 `frame_at` 同口径）。
      expect(frameAt('reasoning', t, true)).toBe('█████');
      expect(frameAt('tool_running', t, true)).toBe('▁');
    }
  });

  it('负时间不崩（时钟回拨 / 注入的假起始值）', () => {
    expect(framesFor('reasoning')).toContain(frameAt('reasoning', -5));
  });

  it('认不出的阶段退回默认，不抛', () => {
    expect(framesFor('不存在的阶段')).toEqual(GLYPHS[DEFAULT_PHASE].frames);
    expect(phaseInterval('不存在的阶段')).toBe(GLYPHS[DEFAULT_PHASE].interval);
  });

  it('undefined 也退回默认', () => {
    expect(framesFor(undefined)).toEqual(GLYPHS[DEFAULT_PHASE].frames);
  });
});

describe('阶段 → 动词', () => {
  it('五个阶段各有一个动词键，不重不漏', () => {
    const keys = PHASES.map((p) => PHASE_VERB[p]);
    expect(keys).toEqual([1, 2, 3, 4, 5]);
    for (const p of PHASES) expect(verbKeyFor(p)).toBe(`spin_verb_${PHASE_VERB[p]}`);
  });

  it('认不出的阶段有兜底（不返回 undefined 键名）', () => {
    expect(verbKeyFor('未知')).toBe('spin_verb_2');
    expect(verbKeyFor(undefined)).toBe('spin_verb_2');
  });
});

describe('卡住判定（R-7）—— 与 ui/ace_spinner.stall_level 同口径', () => {
  it('★阈值 3s 与 Python 的 DEFAULT_STALL_SECONDS 一致（逐字钉住，别各写各的）', () => {
    const src = readFileSync(join(ROOT, 'ui', 'ace_spinner.py'), 'utf-8');
    const py = src.match(/DEFAULT_STALL_SECONDS[^=\n]*=\s*([\d.]+)/)?.[1];
    expect(py, '没抓到 Python 的 DEFAULT_STALL_SECONDS —— 下面的比对会空转').toBeTruthy();
    expect(STALL_SECONDS).toBe(Number(py));
  });

  it('★公式与 Python stall_level 逐字相同（0→1 渐变；边界恰好等于阈值 = 不算卡）', () => {
    expect(stallLevel(2.9)).toBe(0);
    expect(stallLevel(3.0)).toBe(0);               // 不是 `<` 的模糊地带
    expect(stallLevel(4.5)).toBeCloseTo(0.25, 6);  // (4.5-3)/(3*2)
    expect(stallLevel(99)).toBe(1);                // 封顶
    expect(stallLevel(-5)).toBe(0);                // 负时间不崩
    expect(stallLevel(Number.NaN)).toBe(0);        // 垃圾输入不崩
  });

  it('阈值参数可调（测试/未来旋钮，不写死）', () => {
    expect(stallLevel(4.5, 3)).toBeCloseTo(0.25, 6);
    expect(stallLevel(4.5, 5)).toBe(0);
  });
});

describe('Spinner 渲染（R-7 卡住）', () => {
  const t = (k: string): string => k;
  const noColor = (): string | undefined => undefined;
  // 必须长过最慢那一档的帧间隔（reasoning 240ms）—— 否则 setInterval 还没跑第一下，
  // idle 停在 0，断言空转（这正是"假绿"的一种：帧没动、结论却像是"没卡"）。
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 320));

  it('无动效 + 静默超过阈值 → 出现"无响应"的标记（stub t 断言键名）', async () => {
    const lastOutputAt = Date.now() / 1000 - 5;    // 5s 前最后一次产出 ⇒ 已卡
    const { lastFrame, unmount } = mountTree(
      React.createElement(Spinner, { phase: 'reasoning', t, color: noColor, reducedMotion: true, lastOutputAt }),
    );
    await tick();
    const out = lastFrame() ?? '';
    unmount();
    expect(out).toContain('spin_stalled');
  });

  it('工具在跑时**不判**卡住（一条长命令跑 60 秒是正常的）', async () => {
    const lastOutputAt = Date.now() / 1000 - 5;
    const { lastFrame, unmount } = mountTree(
      React.createElement(Spinner, { phase: 'tool_running', t, color: noColor, reducedMotion: true, lastOutputAt }),
    );
    await tick();
    const out = lastFrame() ?? '';
    unmount();
    expect(out).not.toContain('spin_stalled');
  });

  it('★知道是哪个工具就说具名的（"准备中"看不出在调 file_write 还是 file_read）', async () => {
    const named = (k: string, p?: Record<string, string | number>): string =>
      p ? `${k}:${p.tool}` : k;
    const { lastFrame, unmount } = mountTree(
      React.createElement(Spinner, {
        phase: 'tool_running', t: named, color: noColor, reducedMotion: true, tool: 'file_write',
      }),
    );
    const out = lastFrame() ?? '';
    unmount();
    expect(out).toContain('calling_tool_named:file_write');
    expect(out).not.toContain('spin_verb_5');       // 具名了就不再退化回笼统动词
  });

  it('工具阶段但不知名字 → 退回动词表（不印一个空的"正在调用 "）', async () => {
    const { lastFrame, unmount } = mountTree(
      React.createElement(Spinner, {
        phase: 'tool_running', t, color: noColor, reducedMotion: true, tool: '',
      }),
    );
    const out = lastFrame() ?? '';
    unmount();
    expect(out).toContain('spin_verb_5');
    expect(out).not.toContain('calling_tool_named');
  });
});
