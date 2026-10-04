/**
 * 工具卡片 —— 一件工具调用长什么样：状态点 + 工具名 + 目标 + 结果摘要。
 *
 * 字形沿用 Python 侧已经在用的那一套（`ui/ace_cards.py` 的 `GLYPH_*`）：
 *   ◌ 排队 / ◐ 在跑 / ✓ 成功 / ✗ 失败
 * 为什么不让 TS 侧另发明一套：同一个产品在两套前端里用不同的符号，
 * 用户会以为是两种不同的状态。`test/` 里有一条断言把两边钉在一起。
 *
 * 只读类工具成功时**不展开** —— 一次探索动辄几十条"读到了"，逐条刷屏会把真正
 * 重要的那几行挤出屏幕（这是 Python 侧 `_fold_read` 的同一条口径）。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { colorizeDiff, summarizeDiff } from '../render/diff.js';
import { g } from '../render/glyphs.js';
import type { ToolStatus } from '../state/store.js';

export const TOOL_GLYPHS: Record<ToolStatus, string> = {
  running: '◌',
  ok: '✓',
  fail: '✗',
};

/**
 * "成功时折叠"的只读工具集 —— 口径的**唯一来源**是 `ui/ace_cards.READ_TOOLS`。
 *
 * 这份名单此前是**编的**：`file_glob` / `file_grep` / `file_search` / `list_dir`
 * 在 `tools/registry.py` 里**不存在**，而最吵的 `search` / `terminal_view` / `kb_search`
 * 反而不在里面 —— 于是"成功不展开"在两个外壳里**行为不同**。
 * 现在由 `test/shell-parity.test.ts`（R-4）读 Python 源 + 注册表钉住。
 */
export const READ_TOOLS = new Set([
  'file_read', 'search', 'search_read', 'grep', 'glob', 'terminal_view',
  'kb_search', 'kb_list', 'skill_list', 'skill_load', 'goal_status',
  'datetime_now', 'math_calc', 'browser_screenshot',
]);

export interface ToolCardProps {
  tool: string;
  target?: string | undefined;
  status: ToolStatus;
  elapsed?: number | undefined;
  message?: string | undefined;
  exitCode?: number | null | undefined;
  /** 这次改动的 unified diff（写类工具才有）。 */
  diff?: string | undefined;
  /** 主题取色器（由 App 注入，避免每个组件各自读环境变量）。 */
  color: (token: string) => string | undefined;
}

export function ToolCard({
  tool,
  target,
  status,
  elapsed,
  message,
  exitCode,
  diff,
  color,
}: ToolCardProps): React.ReactElement {
  // 过 `g()`：cp936 下 `◐`/`✓`/`✗` 印不出来，会变成乱码（实机可见）
  const glyph = g(TOOL_GLYPHS[status]);
  const statusColor =
    status === 'ok' ? color('tool_ok') : status === 'fail' ? color('tool_fail') : color('tool_pending');

  const head: string[] = [tool];
  if (target) head.push(target);
  // 非零退出码要显眼：命令"跑完了"和"跑对了"是两件事（Python 侧也是这么区分的）。
  if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
    head.push(`exit ${exitCode}`);
  }
  if (status !== 'running' && typeof elapsed === 'number') {
    head.push(`${elapsed.toFixed(1)}s`);
  }

  const isRead = READ_TOOLS.has(tool);
  const showMessage = Boolean(message && message.trim()) && !(isRead && status === 'ok');
  const diffLines = diff ? colorizeDiff(diff) : [];
  const stat = diff ? summarizeDiff(diff) : null;

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={statusColor}>{glyph} </Text>
        <Text bold color={status === 'fail' ? color('error') : color('text')}>
          {head.join('  ')}
        </Text>
        {/* `+N -M` 摆在标题行：改了多少**一眼可见**，不必读完 diff 才知道 */}
        {stat && (stat.added || stat.removed) ? (
          <Text>
            {'  '}
            <Text color={color('success')}>+{stat.added}</Text>
            <Text color={color('dim')}> </Text>
            <Text color={color('error')}>-{stat.removed}</Text>
          </Text>
        ) : null}
      </Text>

      {showMessage ? (
        <Box marginLeft={2}>
          <Text color={color('dim')}>{firstLines(message!, 3)}</Text>
        </Box>
      ) : null}

      {diffLines.length > 0 ? (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {diffLines.map((l, i) => (
            // 不折行：折了就分不清"这是 diff 里的一行"还是"终端折的"
            // 行首固定一格状态槽（`+`/`-`/空格/`~`/`?`），**不是行号** —— 见 render/diff.ts
            <Text key={i} color={color(l.token)} wrap="truncate">
              {`${l.slot} ${l.text || ' '}`}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/** 摘要只给前几行：完整输出该在别处看，卡片是"一眼扫过"用的。 */
function firstLines(text: string, n: number): string {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= n) return lines.join('\n');
  return lines.slice(0, n).join('\n') + `\n… 还有 ${lines.length - n} 行`;
}
