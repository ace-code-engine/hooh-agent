/**
 * 滚动视口 —— 全屏模式下转录区的"可滚历史"。
 *
 * 出处（语义照搬，实现是自己的）：
 *   - pi `ScrollView{follow:'end', primary:true, overscroll:'chain', scrollbar:'auto'}`
 *     （`components/scroll-view.ts`）+ 全屏布局 `createChatViewport`
 *   - Claude Code `ink/components/ScrollBox.tsx`：命令式 `scrollTo` / `scrollBy`
 *
 * 为什么需要它：主屏模式靠**终端自己的回滚缓冲**（内核把滚出视口的行推进终端 scrollback），
 * 但备用屏（全屏）里终端没有回滚 —— 不放一个自己的视口，历史就彻底看不见。
 *
 * 三条状态语义（与 pi 一致）：
 *   1. **跟随尾部**：新内容到来时自动贴底（除非用户主动往上翻过）；
 *   2. **往上翻即脱离**：翻上去就不再被新内容拽回底部（这条不做好，翻历史是白翻）；
 *   3. **翻回底部即恢复跟随**。
 *
 * 与内核自带 `<ScrollBox stickyScroll>` 的取舍（**选保留自制这一版**）：
 *   - 内核那版吃的是 `children`（要求内容全量建树、由它按 `overflow:scroll` 裁剪），
 *     调用方是 `App.tsx`（S2 的地盘）——换接口等于把改动推给别人，且 `renderToScreen`
 *     下无法验证滚动语义（它要一个受限高度的根 + ref 句柄）；
 *   - 自制这版吃 `items` + `renderItem`，自带 `PgUp/PgDn/↑↓/g/G` 与溢出才画的滚动条，
 *     `clampOffset`/`windowRange` 两个纯函数还能被单测直接盯（`test/scroll-box.test.tsx`）；
 *   - 两边都"自己虚拟化"，所以**只用一边**才不重复 —— 这里不引入内核那版。
 *   代价：拿不到鼠标滚轮/拖选（内核版才有）。
 */

import { Box, Text, useInput } from '../../vendor/dsh-ink/kernel.js';
import React from 'react';

export interface ScrollBoxProps<T> {
  items: T[];
  /** 可视高度，按**项**计（一项一行；调用方保证每项只占一行）。 */
  height: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** 是否接管键盘（对话框弹出时应传 false，免得抢键）。 */
  active?: boolean;
  /** 滚动条：`auto` 只有内容溢出时才画。 */
  scrollbar?: 'auto' | 'hidden';
  /** 提示文案（缺省不画提示行）。 */
  hint?: string;
  color?: (token: string) => string | undefined;
}

/** 把偏移夹到合法范围（内容比视口短时恒为 0）。 */
export function clampOffset(offset: number, total: number, height: number): number {
  const max = Math.max(0, total - height);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(offset)));
}

/** 视口窗口：跟随尾部时取最后 `height` 项，否则从 `offset` 起。 */
export function windowRange(
  offset: number,
  total: number,
  height: number,
  stick: boolean,
): { start: number; end: number } {
  const h = Math.max(1, Math.trunc(height));
  if (stick) {
    const start = Math.max(0, total - h);
    return { start, end: Math.min(total, start + h) };
  }
  const start = clampOffset(offset, total, h);
  return { start, end: Math.min(total, start + h) };
}

export function ScrollBox<T>({
  items,
  height,
  renderItem,
  active = true,
  scrollbar = 'auto',
  hint,
  color,
}: ScrollBoxProps<T>): React.ReactElement {
  const h = Math.max(1, Math.trunc(height));
  const [stick, setStick] = React.useState(true);
  // 未跟随时用**绝对偏移**记住位置；跟随时忽略它（贴底由窗口函数算）。
  const [offset, setOffset] = React.useState(Math.max(0, items.length - h));

  const total = items.length;
  const maxStart = Math.max(0, total - h);

  // 内容变长且处于跟随时：偏移跟着走到底（保持贴底）
  React.useEffect(() => {
    if (stick) setOffset(maxStart);
  }, [stick, maxStart]);

  const step = React.useCallback((delta: number): void => {
    const from = stick ? maxStart : clampOffset(offset, total, h);
    const next = clampOffset(from + delta, total, h);
    setOffset(next);
    setStick(next >= maxStart);          // 翻到底 → 恢复跟随
  }, [stick, offset, maxStart, total, h]);

  useInput((input, key) => {
    if (key.pageUp) step(-(h - 1 || 1));
    else if (key.pageDown) step(h - 1 || 1);
    else if (key.upArrow) step(-1);
    else if (key.downArrow) step(1);
    // 首页/末页用 `g` / `G` 而不是 Home/End：Ink 5 的 `Key` 里**没有** home/end
    // （6.x 才有），依赖它就等于依赖一个这台机器上收不到的键。`g`/`G` 到处都收得到。
    else if (input === 'g') { setStick(false); setOffset(0); }
    else if (input === 'G') { setStick(true); setOffset(maxStart); }
  }, { isActive: active });

  const range = windowRange(offset, total, h, stick);
  const visible = items.slice(range.start, range.end);
  const overflow = total > h;
  const showBar = scrollbar === 'auto' && overflow;
  const line = color?.('border');

  return (
    <Box flexDirection="column">
      {!stick && hint ? (
        <Text color={color?.('dim')}>{hint}</Text>
      ) : null}
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {visible.map((item, i) => (
            <Box key={range.start + i} flexDirection="column">
              {renderItem(item, range.start + i)}
            </Box>
          ))}
        </Box>
        {showBar ? (
          <Box flexDirection="column" width={1}>
            {Array.from({ length: h }, (_, i) => {
              // 滑块位置：把可视窗口映射到整条内容上（长度按比例，最短 1 格）
              const thumbLen = Math.max(1, Math.round((h / total) * h));
              const thumbStart = Math.round((range.start / Math.max(1, maxStart)) * (h - thumbLen));
              const on = i >= thumbStart && i < thumbStart + thumbLen;
              return (
                <Text key={i} color={line}>{on ? '█' : '│'}</Text>
              );
            })}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
