/**
 * 任务树面板（`Ctrl+T` 开关）。
 *
 * 与 Python 侧同一条口径：**空树不画**。三样都空时不显示一个只有标题的空框 ——
 * 那只会让人以为"这里本来该有东西"。空的时候给一句话（`tasks_none`），
 * 告诉用户怎么建一个。
 *
 * 状态上色沿用工具卡片那套语义：进行中 = `tool_pending`、完成 = `tool_ok`、
 * 受阻 = `tool_fail`、待办 = `dim`。同一种状态在同一个产品里不该有两种颜色。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { gstr } from '../render/glyphs.js';
import { flattenTaskTree, type TaskNode } from '../render/tasktree.js';

export interface TaskTreeProps {
  tree: TaskNode | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
}

/** 状态 → 主题 token。与工具卡片同一套语义色。 */
export function taskToken(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'tool_pending';
    case 'done':
      return 'tool_ok';
    case 'blocked':
      return 'tool_fail';
    default:
      return 'dim';
  }
}

export function TaskTree({ tree, t, color }: TaskTreeProps): React.ReactElement {
  const lines = flattenTaskTree(tree);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color('border')} paddingX={1}>
      {/* 面板标题复用 `key_tasks`（"任务树"）—— 不另发明键：那一处已经是这个词的
          唯一真相源，新写一个只会与它漂。 */}
      <Text bold color={color('accent')}>
        {t('key_tasks')}
      </Text>
      {lines.length === 0 ? (
        <Text color={color('dim')}>{t('tasks_none')}</Text>
      ) : (
        lines.map((l, i) => (
          // 不折行：折了就分不清"这是树的一行"还是"终端折的"，对齐一乱树就白画了
          <Text key={i} color={color(taskToken(l.status))} wrap="truncate">
            {/* 整行过 `gstr()`：树形连接线（`├└│─`）与状态字形（`▶✓✗`）都在这行里 */}
            {gstr(l.text)}
          </Text>
        ))
      )}
    </Box>
  );
}
