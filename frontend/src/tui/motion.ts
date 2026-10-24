/**
 * 动效基建 —— 常量与 reduced-motion 的**统一出口**（WP-GUI §五.0.3）。
 *
 * 规范 `TUI-SWISS-SPEC.md` §一.6：动画 ≤5 Hz 且只在有事发生时；reduced-motion
 * 必须全静态、且有可读的静帧。所以本模块只有两个东西：
 *
 *   1. `MOTION` 常量表 —— 所有动效消费方从这里取间隔，**不许自设帧率**；
 *      5 Hz 上限即 `frameMs: 200` 的下限。
 *   2. `useReducedMotion()` —— 此前 Spinner 在 App.tsx 里自读
 *      `process.env.ACE_REDUCE_MOTION`，现在收敛到这一个出口，后面所有
 *      动效（流式光标 / 浮层过渡 / 确认闪光）都走它。
 *
 * 计时一律用内核共享时钟（`useAnimationFrame` / `useInterval`，内核 App 在
 * 根部挂了 `ClockProvider`）—— 单一唤醒源、终端失焦自动减速、离屏自动暂停，
 * 任何消费方不得自起 `setInterval`。
 */

/** 动效常量（全为显示间隔，毫秒）。 */
export const MOTION = {
  /** 动效帧间隔下限 = 5 Hz 上限（规范 §一.6）。 */
  frameMs: 200,
  /** 流式光标 `▌` 脉冲：2 Hz（比上限慢一档半，"慢就是好"）。 */
  streamCursorMs: 500,
  /** 浮层开合背景灰阶过渡：2 步 × 125 ms = 250 ms；reduced-motion 直达终帧。 */
  overlaySteps: 2,
  overlayStepMs: 125,
} as const;

/**
 * 减动效开关 —— 统一读 `ACE_REDUCE_MOTION=1`。
 * 进程级开关：改它要重启进程，不进响应式（与内核环境变量口径一致）。
 */
export function useReducedMotion(): boolean {
  return process.env.ACE_REDUCE_MOTION === '1';
}
