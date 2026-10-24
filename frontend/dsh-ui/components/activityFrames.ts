/**
 * Working-activity indicator presets — **HooH 迁移：顶掉 `dsh-working-activity`**。
 *
 * 上游这份是那个 DSH 插件（35 个预设，默认 `moon8` 月相）的薄壳。迁移时**不装它**：
 * 活动指示器这件事 ace 已经做完了（`ui/ace_spinner.py` 的阶段字形 + 噪声填充、
 * `ui/ace_noise_circle.py` 的圆盘），而且前端那份帧表在 `frontend/src/render/spinner.ts`
 * —— 那是**我们的**单一真源，两边（Python / Ink / 这套迁入的 UI）都取它。
 *
 * 于是这里从"再导出一个外部包的预设表"变成"把我们的帧表接成上游要的形状"：
 * 导入名、导出名、`FramePreset` 形状全不变（上游的 `/activity` 选择器、状态行、
 * channel、activityPrefs 都照旧解析），只把**数据源**换成我们的。
 */

import { GLYPHS } from '../../src/render/spinner.js'

/** 上游的预设形状（原来是 `dsh-working-activity/frames` 导出的类型）。 */
export interface FramePreset {
  readonly frames: readonly string[]
  readonly intervalMs: number
}

/** 默认 = 我们的推理帧（噪声填充，5 格）。上游默认是 `moon8` 月相。 */
export const DEFAULT_PRESET = 'noise'

/** 读旧偏好时的兼容：上游退役过的名字一律归到默认。 */
export function normalizeActivityPreset(name: string | undefined): string | undefined {
  return name === 'claude' || name === 'moon8' || name === 'moon' ? DEFAULT_PRESET : name
}

/** 我们提供的预设：噪声填充（默认）+ 其余阶段的字形（诊断/挑着玩用）。 */
export const FRAME_PRESETS: Record<string, FramePreset> = {
  noise: { frames: [...GLYPHS.reasoning.frames], intervalMs: Math.round(GLYPHS.reasoning.interval * 1000) },
  braille: { frames: [...GLYPHS.tool_running.frames], intervalMs: Math.round(GLYPHS.tool_running.interval * 1000) },
  waiting: { frames: [...GLYPHS.waiting.frames], intervalMs: Math.round(GLYPHS.waiting.interval * 1000) },
  answering: { frames: [...GLYPHS.answering.frames], intervalMs: Math.round(GLYPHS.answering.interval * 1000) },
  toolargs: { frames: [...GLYPHS.tool_args.frames], intervalMs: Math.round(GLYPHS.tool_args.interval * 1000) },
}

export const PRESET_NAMES: readonly string[] = ['random', ...Object.keys(FRAME_PRESETS)]

export function isPresetName(name: string): boolean {
  const current = normalizeActivityPreset(name)!
  return current === 'random' || Object.hasOwn(FRAME_PRESETS, current)
}

export function resolvePreset(name: string | undefined): FramePreset {
  const current = normalizeActivityPreset(name)
  const names = Object.keys(FRAME_PRESETS)
  const picked = current === 'random'
    ? names[Math.floor(Math.random() * names.length)]
    : current ?? DEFAULT_PRESET
  return FRAME_PRESETS[picked!] ?? FRAME_PRESETS[DEFAULT_PRESET]!
}
