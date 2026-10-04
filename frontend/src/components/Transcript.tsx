/**
 * 转写区 —— 把状态里的条目按类型分别渲染。
 *
 * 这里做了两件"体验"上的取舍，都是踩过的坑：
 *   1. **notice 归拢显示**，不是每条一行。引擎会发很多 notice（工具时间线、记忆注入、
 *      拒绝理由……），逐条散在对话里会把"用户说了什么、Agent 答了什么"这条主线冲散。
 *   2. **流式回复在末尾带光标**。没有它，用户分不清"它还在说"和"它卡住了" ——
 *      这两者的后续动作完全不同（等 vs 中断）。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React, { useMemo } from 'react';

import { gstr } from '../render/glyphs.js';
import { parseMarkdown } from '../render/markdown.js';
import type { Item } from '../state/store.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { Rule } from './layout/PageMargin.js';

/**
 * 助手消息 —— 走 Markdown 渲染。
 *
 * `useMemo` 不是过度优化：流式期间每来一个增量都会重渲染，而解析是 O(文本长度)。
 * 不缓存的话整段回复是 O(n²)，长回答会肉眼可见地变卡。
 */
const AssistantItem = React.memo(function AssistantItem({
  text,
  streaming,
  color,
}: {
  text: string;
  streaming: boolean;
  color: (token: string) => string | undefined;
}): React.ReactElement {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <Box>
      <Text color={color('dim')}>{gstr('◈ ')}</Text>
      <Box flexDirection="column">
        <Markdown blocks={blocks} color={color} streaming={streaming} />
      </Box>
    </Box>
  );
});

export interface TranscriptProps {
  items: Item[];
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
}

export function Transcript({ items, t, color }: TranscriptProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Box key={it.id} flexDirection="column" marginBottom={1}>
          {/* 轮次边界（规范 §2「区间隔 = 1 空行 + 整宽细线 + 1 空行」）：
              只在**前面真的还有东西**时才画 —— 第一条用户消息上面没有"上一轮"，
              画一条悬空的线只是噪音（这就是"线在哪儿被内容打断"的那一档）。

              这条线**不出血**（`bleed={false}`）：转录所在的表面右边可能还有别的东西
              （全屏时是滚动视口那 1 列滚动条），出血过去会压到别人的格子上。
              版面级那条（`App` 里转录与底部区之间）才出血。 */}
          {it.kind === 'user' && i > 0 ? (
            <Box marginBottom={1}>
              <Rule bleed={false} color={color} />
            </Box>
          ) : null}
          <ItemView item={it} t={t} color={color} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * **必须 memo**：App 每次状态变化都会重渲染，而流式期间那是每秒几十次。
 * 不 memo 的话，每来一个增量就把**整个历史**（含每一张工具卡片、每一段 Markdown）
 * 重画一遍 —— 长对话是 O(n²)，而且越聊越卡。
 *
 * 能生效的前提是 `item` 的**引用**在没变时保持稳定 —— reducer 里正是这么做的
 * （`push` 只新建那一条、其余沿用旧对象）。这条约束不能破。
 */
const ItemView = React.memo(function ItemView({
  item,
  t,
  color,
}: {
  item: Item;
  t: TranscriptProps['t'];
  color: TranscriptProps['color'];
}): React.ReactElement | null {
  switch (item.kind) {
    case 'user':
      return (
        <Text>
          <Text color={color('accent')}>{gstr('❯ ')}</Text>
          <Text color={color('text')}>{item.text}</Text>
        </Text>
      );

    case 'assistant':
      return <AssistantItem text={item.text} streaming={item.streaming} color={color} />;

    case 'tool':
      return (
        <ToolCard
          tool={item.tool}
          target={item.target}
          status={item.status}
          elapsed={item.elapsed}
          message={item.message}
          exitCode={item.exitCode}
          diff={item.diff}
          color={color}
        />
      );

    case 'notice':
      // 归拢成 dim 的一行，前缀 ▏ 表示"这是旁白，不是对话"
      return (
        <Text color={color('dim')}>
          {'  '}
          {gstr('▏')} {item.text}
        </Text>
      );

    case 'error':
      return (
        <Text color={color('error')}>
          {'  '}
          {gstr('✗')} {item.text}
        </Text>
      );

    case 'permission':
      return (
        <Text color={color('dim')}>
          {'  '}
          {gstr('▏')} {t('perm_request_title', { tool: item.tool })}
          {item.answered
            ? ` — ${t(
                item.answered === 'deny'
                  ? 'perm_opt_deny'
                  : item.answered === 'session'
                    ? 'perm_opt_session'
                    : 'perm_opt_once',
              )}`
            : ''}
        </Text>
      );

    default:
      return null;
  }
});
