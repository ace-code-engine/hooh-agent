/**
 * 主屏鼠标跟踪 —— 全局启用 SGR 鼠标（点击 / 滚轮 / hover / 拖拽），**不进备用屏**。
 *
 * 为什么必须有这个组件：内核的鼠标解析与分发（`parse-keypress.js` → app.js
 * `handleMouseEvent` → `hit-test.js`）**从不依赖备用屏状态**，缺的只是有人往
 * 终端写模式序列 —— 全屏时 `<AlternateScreen mouseTracking>` 顺手写了，主屏
 * 此前没人写，终端根本不会上报鼠标事件。
 *
 * 写法仿 `alternatescreen.js`：`useInsertionEffect`（比首帧更早）+
 * `TerminalWriteContext`（内核 App 在根部提供；测试路径 `renderToScreen`
 * 没有 write ⇒ 一个字节不写，与备用屏组件同一道护栏）。
 *
 * **三个时机**：
 *   1. 挂载 → ENABLE；
 *   2. 卸载 → DISABLE；
 *   3. `reassertKey` 变化 → 清理后重写。为什么需要：进出全屏时 `Root` 换的是
 *      `<AlternateScreen>` 的元素类型，它的卸载清理会写 DISABLE（alternatescreen.js:24），
 *      而这层没卸载、effect 不会自己重跑 —— 把全屏开关传进来，备用屏退出后
 *      由这里重新接管。React 时序保证最后一次写生效：卸载清理在 mutation 相、
 *      幸存组件的 insertion effect 在 layout 相。
 *
 * **失焦自愈**：复焦（DECSET 1004 的 FOCUS_IN）常伴随终端侧私有模式被重置
 * （tmux detach、Windows 控制台重连）。内核只对备用屏自愈（ink.js:1644 那道
 * 门在 `altScreenMouseTracking` 上），主屏不管 —— 这里监听焦点，复焦瞬间补写。
 *
 * **逃生口**（两层，见 docs/design/GUI-OVERHAUL.md §六）：
 *   - `ACE_NO_MOUSE=1`：本组件完全不写模式序列，恢复终端原生选择（给以复制
 *     文本为主的使用者）；
 *   - 内核自带 `DSH_TUI_DISABLE_MOUSE=1` 语义不变（关点击、保滚轮）。
 *   鼠标模式开启时，终端原生文本选择按住 **Shift** 拖拽（xterm / Windows
 *   Terminal 通用约定）。
 */

import React, { useContext, useEffect, useInsertionEffect } from 'react';

import {
  DISABLE_MOUSE_TRACKING,
  ENABLE_MOUSE_TRACKING,
  TerminalWriteContext,
  useTerminalFocus,
} from '../../vendor/dsh-ink/kernel.js';

export interface MouseTrackingProps {
  children?: React.ReactNode;
  /**
   * 变化即重断言。`Root` 把全屏开关传进来：`<AlternateScreen>` 进出备用屏会
   * 在自己的清理里关掉鼠标模式，这里必须跟着补一枪（文件头注释·时机 3）。
   */
  reassertKey?: string | number | boolean;
}

export function MouseTracking({ children, reassertKey }: MouseTrackingProps): React.ReactElement {
  const write = useContext(TerminalWriteContext);
  const focused = useTerminalFocus();
  // 进程级开关：改环境变量要重启，不进响应式（与内核 `DSH_TUI_DISABLE_MOUSE` 同一口径）。
  const enabled = process.env.ACE_NO_MOUSE !== '1';

  useInsertionEffect(() => {
    if (!write || !enabled) return;
    write(ENABLE_MOUSE_TRACKING);
    return () => {
      write(DISABLE_MOUSE_TRACKING);
    };
  }, [write, enabled, reassertKey]);

  // 复焦自愈。挂载那次 `focused` 初始即 true，会把同一组幂等序列再写一遍 ——
  // 有意留作保险（写序仍在首帧之前/附近，量级 28 字节，不省这个分支）。
  useEffect(() => {
    if (!write || !enabled) return;
    if (focused) write(ENABLE_MOUSE_TRACKING);
  }, [write, enabled, focused]);

  return <>{children}</>;
}
