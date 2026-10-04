/**
 * 备用屏（alternate screen）—— **内核版**，与自制的 `alternate-screen.tsx` 并列存在。
 *
 * 为什么另起一个文件而不是就地改写旧的：旧文件是**回滚路径**（它自己写 `?1049h`/`?1049l`），
 * 留着不动，退回去只需把 `Root.tsx` 的 import 换回 `./tui/alternate-screen.js`。
 *
 * 为什么要换成内核的：备用屏不只是两个转义序列 —— 内核的渲染器自己记着
 * `setAltScreenActive()` / 帧缓冲 / 前后帧对照（`ink.js` 里 "prevFrameContaminated"、
 * "needsSurfaceRepaint"、`exitAlternateScreen` 那一整段就是为这个场景写的）。
 * 自己往 `process.stdout` 灌 `?1049h` 会绕过它，于是它以为还在主屏、继续按主屏 diff ——
 * 进出备用屏那一帧必然失配（撕裂 / 回主屏一片空白）。
 * 而且内核写 `1049` 走的是 `TerminalWriteContext`（`app.js` 的 `writeRaw` → `stdout.write`），
 * 用的还是 `useInsertionEffect` —— 比画第一帧更早，正是为了避开"首帧画在主屏上"。
 *
 * 接口与旧文件一致（`children` + `enabled`），所以 `Root.tsx` 只换 import 一行。
 *
 * ⚠️ 已知代价（内核的 `<AlternateScreen>` 只有"挂载即进入、卸载即退出"语义，**没有 `enabled`**）：
 * 运行时把 `enabled` 从 true 翻到 false 会换掉这一层的元素类型 ⇒ `App` 被卸载重挂，
 * **转录区会被清空**。旧实现只写序列、不卸载，所以那时切 `/fullscreen` 不丢历史。
 * 内核没有给"不卸载但退出备用屏"的口子，要保住历史得把转录状态提到 `App` 之外（S2 的地盘）。
 */

import React from 'react';

import { AlternateScreen as KernelAlternateScreen } from '../../vendor/dsh-ink/kernel.js';

export interface AlternateScreenProps {
  children: React.ReactNode;
  /** false = 留在主屏（非全屏会话）。不进备用屏时这层整个不存在。 */
  enabled?: boolean;
}

export function AlternateScreen({
  children,
  enabled = true,
}: AlternateScreenProps): React.ReactElement {
  // 不需要自己判 `process.stdout.isTTY`：内核只在有渲染器（`render()` 建的那个）时才出声，
  // 测试路径（`renderToScreen`）拿不到 `TerminalWriteContext`，它一个字节都不写。
  if (!enabled) return <>{children}</>;
  return <KernelAlternateScreen mouseTracking>{children}</KernelAlternateScreen>;
}
