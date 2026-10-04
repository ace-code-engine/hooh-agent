/**
 * 备用屏（alternate screen）—— 全屏会话的容器。
 *
 * 出处：pi 的 `TuiAltScreen` vs `TuiMainScreen` 是**接口级二选一**
 * （`tui-renderer.ts:18-47`）；Claude Code 有 `ink/components/AlternateScreen.tsx`。
 *
 * 为什么两者都要：
 *   - **主屏**（默认）：转录进终端自己的回滚缓冲，往上翻是终端的能力，历史再多也翻得到；
 *   - **备用屏**（全屏）：画面归自己管，能画滚动条/就地搜索/固定输入区 —— 代价是
 *     **终端没有回滚了**，所以必须配一个自己的视口（见 `scroll-box.tsx`）。
 *
 * 退出时一定要还原：备用屏没退干净，用户回到主屏会看到一片空白（比崩了还难查）。
 */

import React from 'react';

export interface AlternateScreenProps {
  children: React.ReactNode;
  /** 非 TTY（管道/测试）时自动关闭，避免往管道里灌控制序列。 */
  enabled?: boolean;
}

const ENTER = '\x1b[?1049h';
const LEAVE = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

export function AlternateScreen({
  children,
  enabled = true,
}: AlternateScreenProps): React.ReactElement {
  const on = enabled && Boolean(process.stdout?.isTTY);
  React.useEffect(() => {
    if (!on) return undefined;
    process.stdout.write(ENTER + HIDE_CURSOR);
    return () => {
      process.stdout.write(SHOW_CURSOR + LEAVE);
    };
  }, [on]);
  return <>{children}</>;
}
