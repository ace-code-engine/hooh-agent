/**
 * 设计系统 · 容器与列表（照 Claude Code `design-system/` 的结构，实现是自己的）。
 *
 * 一套共同的取舍：**分区用整宽细线，不用边框**（`docs/TUI-SWISS-SPEC.md` §1 第 2 条）。
 * CC 用 `Pane`/`Dialog` 也是同一个思路：一个标题 + 一条线 + 内容 + 一行 byline，
 * 不画四边闭合的框 —— 那种框在窄终端上会把内容挤到只剩十几列。
 */

import { Box, Text } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { Byline, Divider, StatusIcon, type ColorFn } from './primitives.js';
import { g } from '../../render/glyphs.js';

// ─────────────────────────────────────────────────────────── Pane

export function Pane({
  title,
  children,
  color,
  width,
  footer,
}: {
  title?: string;
  children: React.ReactNode;
  color?: ColorFn;
  width?: number;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {title ? (
        <Text bold color={color?.('accent')}>
          {title}
        </Text>
      ) : null}
      <Divider title="" color={color} {...(width === undefined ? {} : { width })} />
      <Box flexDirection="column" marginTop={0}>{children}</Box>
      {footer ? (
        <Box marginTop={0}>{footer}</Box>
      ) : null}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────── Tabs

export interface TabItem {
  key: string;
  label: string;
  /** 右侧计数/状态（可选）。 */
  badge?: string;
}

/** 页签行：当前页**反显**（瑞士规范里"选中"只用反显，不额外上色）。 */
export function Tabs({
  tabs,
  active,
  color,
}: {
  tabs: TabItem[];
  active: string;
  color?: ColorFn;
}): React.ReactElement {
  return (
    <Box flexDirection="row">
      {tabs.map((tab, i) => {
        const on = tab.key === active;
        return (
          <Box key={tab.key} marginRight={2}>
            <Text
              color={on ? color?.('text') : color?.('dim')}
              bold={on}
              inverse={on}
            >
              {` ${tab.label}${tab.badge ? ` ${tab.badge}` : ''} `}
            </Text>
            {i === tabs.length - 1 ? null : <Text color={color?.('dim')}> </Text>}
          </Box>
        );
      })}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────── ListItem

/**
 * 列表项（照 CC `ListItem`）：聚焦 `❯`、选中 `✓`、可选描述行。
 * 三种标记**位置固定**（都占同样宽的标记列），所以有没有标记都不会让文字左右跳。
 *
 * **可点**（`onClick` / `onHover`）：内核早就把鼠标能力给全了
 * （`BoxProps.onClick`/`onMouseEnter`，命中测试 `hit-test.js` 的 `hitTestWithOverlays`），
 * `Root` 也挂了 `MouseTracking`（主屏也上报鼠标事件）—— 此前只是**没有任何组件消费**，
 * 所以点了等于没点。事件挂在**最外层盒**上：带描述项是两行，两行都该算这一项。
 *
 * 为什么不做成"默认就带点击"：动作是调用方的事（点一项是确认、选中、还是切页签？），
 * 这里只负责把事件转出来。
 */
export function ListItem({
  label,
  description,
  isFocused = false,
  isSelected = false,
  color,
  hint,
  right,
  onClick,
  onHover,
}: {
  label: React.ReactNode;
  description?: string;
  isFocused?: boolean;
  isSelected?: boolean;
  color?: ColorFn;
  hint?: string;
  /** 右对齐的一列（计数/耗时）—— 右对齐才便于竖着比较，见 `ace_panel.list_row`。 */
  right?: string;
  /** 鼠标点中这一项（整项两行都算）。 */
  onClick?: () => void;
  /** 鼠标移到这一项上（用于"悬停跟随光标"）。 */
  onHover?: () => void;
}): React.ReactElement {
  // 标记字形过降级层：`❯`/`✓` 在 cp936 控制台上印不出来（替身 `>`/`v`，同宽 1 列，
  // 所以定宽标记列不会被撑开）。
  const marker = g(isFocused ? '❯' : isSelected ? '✓' : ' ');
  return (
    <Box
      flexDirection="column"
      {...(onClick ? { onClick } : {})}
      {...(onHover ? { onMouseEnter: onHover } : {})}
    >
      <Box flexDirection="row">
        <Box width={2}>
          <Text color={isFocused ? color?.('accent') : color?.('success')}>{marker}</Text>
        </Box>
        <Text color={color?.('text')}>{label}</Text>
        {hint ? <Text color={color?.('dim')}>{`  ${hint}`}</Text> : null}
        {right ? (
          <>
            <Box flexGrow={1} />
            <Text color={color?.('dim')}>{right}</Text>
          </>
        ) : null}
      </Box>
      {description ? (
        <Box flexDirection="row">
          <Box width={2} />
          <Text color={color?.('dim')}>{description}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────── Dialog

/**
 * 统一对话框外壳：标题 + 整宽细线 + 内容 + byline 提示行。
 *
 * 与既有 `PermissionDialog`/`ChoiceDialog` 的关系：那两个是**具体**对话框，
 * 这个是可以被它们共用的**外壳** —— 以前各自的标题/分隔/提示各写一遍，
 * 于是"同一个产品里两种对话框气质不同"。
 */
export function Dialog({
  title,
  status,
  children,
  hints,
  color,
  width,
  widthHint,
}: {
  title: string;
  status?: string;
  children: React.ReactNode;
  hints?: Array<string | false | null | undefined>;
  color?: ColorFn;
  width?: number;
  widthHint?: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row">
        {status ? <StatusIcon status={status} withSpace color={color} /> : null}
        <Text bold color={color?.('accent')}>{title}</Text>
      </Box>
      <Divider color={color} {...(width === undefined ? {} : { width })} />
      <Box flexDirection="column" paddingX={2} marginTop={0}>{children}</Box>
      {hints && hints.some(Boolean) ? (
        <Box paddingX={2}>
          <Byline parts={hints} color={color} />
        </Box>
      ) : null}
      {widthHint ? (
        <Box paddingX={2}>
          <Text color={color?.('dim')}>{widthHint}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────── LoadingState

/** 等待态：一行标记 + 文案（+ 可选副标题）。转轮本身由 `Spinner` 管，这里只管排版。 */
export function LoadingState({
  message,
  subtitle,
  icon = '◌',
  bold = false,
  color,
}: {
  message: string;
  subtitle?: string;
  icon?: string;
  bold?: boolean;
  color?: ColorFn;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={color?.('tool_pending')}>{`${g(icon)} `}</Text>
        <Text color={color?.('dim')} bold={bold}>{message}</Text>
      </Box>
      {subtitle ? (
        <Box paddingLeft={2}>
          <Text color={color?.('dim')}>{subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
