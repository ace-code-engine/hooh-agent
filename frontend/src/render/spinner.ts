/**
 * 等待指示器的纯逻辑 —— **字形与帧间隔逐条照抄 `ui/ace_spinner.py`**。
 *
 * 为什么不能自己挑一套好看的：那边的注释写着「**速度本身是语义**」——
 * `waiting` 快（0.08s，等首字节，网络在动）、`reasoning` 慢（0.24s，模型在推）、
 * `tool_running` 中等（0.16s，工具在跑）。用户看速度就能大致判断"现在卡在哪一步"。
 * 两套前端用不同速度，这个信息就废了。`test/spinner.test.ts` 会读那个 .py 比对。
 *
 * 纯逻辑：不算时间、不订阅定时器（`elapsed` 由调用方传），所以可穷举测。
 */

export const PHASES = ['waiting', 'reasoning', 'answering', 'tool_args', 'tool_running'] as const;
export type Phase = (typeof PHASES)[number];

export const DEFAULT_PHASE: Phase = 'reasoning';

/** 帧序列 + 帧间隔（秒）。与 `ace_spinner._GLYPHS` 逐条一致。 */
export const GLYPHS: Record<Phase, { frames: string[]; interval: number }> = {
  waiting: { frames: ['·', '˙', '•', '˙'], interval: 0.08 },
  // 推理：**噪声填充**（照 `circle-noise-fill.html` 缩到 5 格，填满后倒放）。
  // 原来这里是月相 `◐◓◑◒`（上游 `moon` 预设）——被这个换掉。帧序列由
  // `ui/ace_spinner.noise_frames()` 生成、**写成字面量**给一致性测试解析；
  // 两者由 `test_all.py` 里那条 `noise_frames() == list(_GLYPHS["reasoning"][0])` 钉住。
  reasoning: {
    frames: [
      '·····', '·····', '···██', '··███', '█████', '█████', '█████', '··███', '···██',
      '·····', '·····',
    ],
    // 仍是"最慢"那一档（> tool_running 的 0.16）：速度即语义，换字形不改速度。
    interval: 0.18,
  },
  answering: { frames: ['◈', '◇', '◆', '◇'], interval: 0.12 },
  tool_args: { frames: ['▖', '▘', '▝', '▗'], interval: 0.1 },
  tool_running: { frames: ['▁', '▃', '▅', '▇', '▅', '▃'], interval: 0.16 },
};

export function normPhase(phase: string | undefined): Phase {
  return (PHASES as readonly string[]).includes(String(phase))
    ? (phase as Phase)
    : DEFAULT_PHASE;
}

export function framesFor(phase: string | undefined): string[] {
  return [...GLYPHS[normPhase(phase)].frames];
}

export function phaseInterval(phase: string | undefined): number {
  return GLYPHS[normPhase(phase)].interval;
}

/**
 * 当前该画哪一帧。
 *
 * `reducedMotion` 时**恒取固定的一帧** —— 不是"慢一点"，是完全不动。
 * 对前庭敏感的用户，缓慢旋转同样难受；降级要降到底，不能只降一半。
 *
 * 例外：推理阶段那串噪声填充的**首帧是空格子**，静态时会像"没在干活"，
 * 所以无动效时给它**填满**那一帧（与 `ui/ace_spinner.frame_at` 同口径）。
 */
export function frameAt(
  phase: string | undefined,
  elapsed: number,
  reducedMotion = false,
): string {
  const frames = framesFor(phase);
  if (reducedMotion) {
    return normPhase(phase) === 'reasoning' ? '█████' : frames[0]!;
  }
  const idx = Math.floor(Math.max(0, elapsed) / phaseInterval(phase)) % frames.length;
  return frames[idx]!;
}

/**
 * 卡住判定 —— 与 `ui/ace_spinner.stall_level` / `DEFAULT_STALL_SECONDS` 同口径（**R-7**）。
 *
 * 为什么这里要有：Python 的等待行会在"静默超过阈值"后**渐变到告警色**（无动效时降级成
 * 文字"无响应"），而 Ink 此前只有字形 + 秒数 —— 同一个模型卡死，换到 Ink 就看不出来。
 * `stall_level` 是纯函数（0→1 渐变），照抄公式而不是另立一套"卡没卡"的判据。
 */

/** 静默多久算"卡住"（秒）。与 `ace_spinner.DEFAULT_STALL_SECONDS` 一致，由 parity 测试钉住。 */
export const STALL_SECONDS = 3;

/**
 * "卡住程度" 0→1：静默超过阈值后随时间递增 —— 再过一整个阈值时长到满。
 * 公式 `(idle - th) / (th * 2)` 与 `ui/ace_spinner.stall_level` 逐字相同。
 */
export function stallLevel(idle: number, threshold: number = STALL_SECONDS): number {
  const i = Math.max(0, idle);
  if (!Number.isFinite(i)) return 0;
  if (i <= threshold) return 0;
  return Math.min(1, (i - threshold) / (threshold * 2));
}
