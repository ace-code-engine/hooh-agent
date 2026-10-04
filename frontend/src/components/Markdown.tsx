/**
 * Markdown 渲染 —— 把 `render/markdown.ts` 产出的 Block 树画出来。
 *
 * 两条与 Python 侧对齐的取舍：
 *   1. **代码块不折行**：折了就分不清"这是代码里的换行"还是"终端折的"。
 *      宁可横向溢出由终端处理，也不擅自折。
 *   2. **引用/列表缩进用可见前缀**，不用纯空格 —— 纯空格在窄终端里一折行就归零，
 *      层级感全丢。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { Divider, useColumns } from './design-system/index.js';
import { gstr } from '../render/glyphs.js';
import type { Block, Span, TableRow } from '../render/markdown.js';
import { displayWidth } from '../render/text.js';

export interface MarkdownProps {
  blocks: Block[];
  color: (token: string) => string | undefined;
  /** 流式中：末尾画一个光标，让人知道"它还在说"而不是"卡住了"。 */
  streaming?: boolean;
  /**
   * 渲染宽度（列）。**可选**：不给就走 `useColumns()` 的规则
   * （`TerminalSizeContext` ?? 80）—— 真机由内核 `<App>` 的 Provider 供真实列宽，
   * 测试直接给这个 prop 就能钉死宽度，两条路都不抛错、不空屏。
   */
  width?: number;
}

function Spans({ spans, color }: { spans: Span[]; color: MarkdownProps['color'] }): React.ReactElement {
  return (
    <>
      {spans.map((s, i) => {
        if (s.code) {
          return (
            <Text key={i} color={color('info')}>
              {s.text}
            </Text>
          );
        }
        if (s.bold) {
          return (
            <Text key={i} bold color={color('text')}>
              {s.text}
            </Text>
          );
        }
        if (s.italic) {
          return (
            <Text key={i} italic color={color('dim')}>
              {s.text}
            </Text>
          );
        }
        return (
          <Text key={i} color={color('text')}>
            {s.text}
          </Text>
        );
      })}
    </>
  );
}

/**
 * 表格 —— 与终端 `ace_markdown._render_table` **同一套排版**：列宽按显示宽度算（中文占两列），
 * 边框 `│ ├ ┼ ┤ ─`，总宽超出终端时按比例压缩每一列（而不是把最后一列挤没）。
 *
 * 为什么单独一个组件：列宽要跟着**终端宽度**变，而在 `BlockView` 的 switch 里读 hook
 * 会违反 hooks 规则。宽度走 `useColumns(width)`（`width` prop ?? 终端列宽 ?? 80）。
 *
 * 已知天花板：单元格内容超宽时**不截断**（截断会把行内样式切碎），交给终端折行；
 * 终端那份是截断的。真在意的话，把 `cols` 从 App 一路传进来再走截断那条路。
 */
function Table({
  rows,
  color,
  width,
}: {
  rows: TableRow[];
  color: MarkdownProps['color'];
  width?: number;
}): React.ReactElement {
  const cols = useColumns(width);
  const plain = rows.map((r) => r.map((spans) => spans.map((s) => s.text).join('')));
  const ncol = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: ncol }, (_, j) =>
    Math.max(1, ...plain.map((r) => displayWidth(r[j] ?? ''))));
  // 3 = "│ " + " │" 的最小间隔（与 `_render_table` 的 `cols * 3 + 1` 同算法）
  const room = Math.max(12, cols - (ncol * 3 + 1));
  const total = widths.reduce((a, b) => a + b, 0);
  const fit = total > room && total > 0
    ? widths.map((w) => Math.max(4, Math.floor((w * room) / total)))
    : widths;
  const rule = '├' + fit.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';

  return (
    <Box flexDirection="column">
      {rows.map((r, i) => (
        <React.Fragment key={i}>
          <Text>
            <Text color={color('border')}>│ </Text>
            {Array.from({ length: ncol }, (_, j) => (
              <React.Fragment key={j}>
                {j > 0 ? <Text color={color('border')}> │ </Text> : null}
                <Spans spans={r[j] ?? []} color={color} />
                <Text>{' '.repeat(Math.max(0, (fit[j] ?? 0) - displayWidth(plain[i]?.[j] ?? '')))}</Text>
              </React.Fragment>
            ))}
            <Text color={color('border')}> │</Text>
          </Text>
          {i === 0 ? <Text color={color('border')}>{rule}</Text> : null}
        </React.Fragment>
      ))}
    </Box>
  );
}

export function Markdown({ blocks, color, streaming = false, width }: MarkdownProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        return (
          <Box key={i} flexDirection="column">
            <BlockView block={b} color={color} cursor={streaming && last} width={width} />
          </Box>
        );
      })}
    </Box>
  );
}

function BlockView({
  block,
  color,
  cursor,
  width,
}: {
  block: Block;
  color: MarkdownProps['color'];
  cursor: boolean;
  width?: number;
}): React.ReactElement {
  switch (block.kind) {
    case 'heading': {
      // h1/h2 加粗并上强调色；h3 以下只加粗 —— 全用强调色会让正文里的重点失去对比。
      const strong = block.level <= 2;
      return (
        <Text bold color={strong ? color('accent') : color('text')}>
          <Spans spans={block.spans} color={color} />
          {cursor ? <Text color={color('dim')}>{gstr('▌')}</Text> : null}
        </Text>
      );
    }

    case 'paragraph':
      return (
        <Text color={color('text')}>
          <Spans spans={block.spans} color={color} />
          {cursor ? <Text color={color('dim')}>{gstr('▌')}</Text> : null}
        </Text>
      );

    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((it, i) => (
            <Text key={i} color={color('text')}>
              <Text color={color('dim')}>{block.ordered ? `${i + 1}. ` : '· '}</Text>
              <Spans spans={it} color={color} />
            </Text>
          ))}
        </Box>
      );

    case 'code':
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={color('border')} paddingX={1}>
          {block.lang ? (
            <Text color={color('dim')}>{block.lang}</Text>
          ) : null}
          {block.lines.map((l, i) => (
            // wrap="truncate"：代码不折行（见文件头说明）
            <Text key={i} color={color('text')} wrap="truncate">
              {l || ' '}
            </Text>
          ))}
        </Box>
      );

    case 'quote':
      return (
        <Text color={color('dim')}>
          <Text color={color('border')}>{gstr('▏ ')}</Text>
          <Spans spans={block.spans} color={color} />
        </Text>
      );

    case 'table':
      return <Table rows={block.rows} color={color} width={width} />;

    case 'hr':
      // **整宽**分隔线（此前固定 20 个 `─`：宽终端上像没画完）。宽度走 `useColumns()`
      // （prop ?? 终端列宽 ?? 80）—— 与 Python 侧 `ace_widgets.divider` 同观感。
      return <Divider color={color} width={width} />;

    default:
      return <Text> </Text>;
  }
}
