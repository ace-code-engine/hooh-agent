/**
 * **会话管理屏** —— 双栏：左＝工作区，右＝该工作区的会话。
 *
 * 照 dsh-TUI 的会话管理屏（用户给的截图）：
 *   ① 顶部标题行（`■ 标题` + 元信息）；
 *   ② 筛选行（输入即过滤，旁边给命中数 —— 不给的话用户不知道是自己没匹配还是界面卡了）；
 *   ③ 双栏 + 1 列分隔：**选中的那一栏**才吃键（左栏只列工作区与条数，右栏才是会话）；
 *   ④ 每行**两行一条**：主行右对齐计数，次行降灰放路径/时间（`ListItem.right`）；
 *   ⑤ 底部一行键位提示；
 *   ⑥ 空状态给一句话，不留白。
 *
 * **点击**：`ListItem` 已经带 `onClick`/`onHover`，但内核只在备用屏派发点击
 * （见 `test/click.test.tsx` 的说明），所以这套屏**键盘优先**，备用屏下鼠标是白拿的。
 *
 * 数据来自 `App` 已有的 `sessions`（`client.requestSessions()`，与 `@session` 菜单同一份），
 * 选中后回传的仍是**引擎的 `/resume <编号>` 语义**（1 起算），不新增协议。
 */

import { Box, Text, useInput } from '../../../vendor/dsh-ink/kernel.js';
import React, { useCallback, useMemo, useState } from 'react';

import { ListItem, useColumns } from '../design-system/index.js';
import { Rule } from '../layout/PageMargin.js';
import { PICKER_KEYS } from '../pickers/Picker.js';
import { pickerWindow } from '../pickers/window.js';
import { gstr } from '../../render/glyphs.js';
import { truncateWidth } from '../../render/text.js';
import {
  filterSessions,
  groupByWorkspace,
  pruneEmptyGroups,
  workspaceRoot,
  type SessionLike,
} from './layout.js';

export const SESSION_MANAGER_KEYS = {
  title: 'sessions_manage_title',
  count: 'sessions_manage_count',
  filter: 'sessions_manage_filter',
  empty: 'sessions_manage_empty',
  workspaces: 'sessions_manage_workspaces',
  hint: 'sessions_manage_hint',
} as const;

export interface SessionWire extends SessionLike {
  readonly when?: string;
  readonly turns?: number;
}

export interface SessionManagerProps {
  /** 候选会话（引擎给的顺序：最近在前）。 */
  sessions: readonly SessionWire[];
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  /** 宽度口径：`width` ?? `TerminalSizeContext.columns` ?? 80。 */
  width?: number;
  /** 选中一条会话（回传**会话在原始数组里的下标**，调用方换算成 `/resume <n>`）。 */
  onPick: (index: number) => void;
  onClose: () => void;
  /** 一次能显示几行（标题/筛选/分隔/提示之外的可视高度）。 */
  rows?: number;
}

export function SessionManager({
  sessions,
  t,
  color,
  width,
  onPick,
  onClose,
  rows = 12,
}: SessionManagerProps): React.ReactElement {
  const columns = useColumns(width);
  const [query, setQuery] = useState('');
  const [side, setSide] = useState<'left' | 'right'>('right');
  const [groupIndex, setGroupIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);

  const all = useMemo(() => [...sessions], [sessions]);
  const groups = useMemo(
    () => pruneEmptyGroups(groupByWorkspace(filterSessions(all, query))),
    [all, query],
  );
  const gIndex = groups.length === 0 ? 0 : Math.min(groupIndex, groups.length - 1);
  const current = groups[gIndex];
  const rowsOfGroup = current?.rows ?? [];
  const rIndex = rowsOfGroup.length === 0 ? 0 : Math.min(rowIndex, rowsOfGroup.length - 1);

  /** 会话在**原始数组**里的下标 —— `onPick` 要的是它（不是过滤后的位置）。 */
  const originalIndex = useCallback(
    (row: SessionWire | undefined): number => (row ? all.indexOf(row) : -1),
    [all],
  );

  // 复用选择器那套窗口函数：黏边、不循环、焦点行永远可见（同一界面里两套滚动手感是 bug）
  const winLeft = pickerWindow(groups.map(() => ({ height: 2 })), gIndex, rows);
  const winRight = pickerWindow(rowsOfGroup.map(() => ({ height: 2 })), rIndex, rows);

  useInput((input, key) => {
    if (key.escape) {
      // 有筛选先清筛选（与截图里那句 `Esc 清空筛选` 一致），清干净了再关屏。
      if (query !== '') setQuery('');
      else onClose();
      return;
    }
    if (key.upArrow || key.downArrow) {
      const delta = key.upArrow ? -1 : 1;
      if (side === 'left') {
        if (groups.length === 0) return;
        setGroupIndex((i) => (i + delta + groups.length) % groups.length);
        setRowIndex(0);
      } else {
        if (rowsOfGroup.length === 0) return;
        setRowIndex((i) => (i + delta + rowsOfGroup.length) % rowsOfGroup.length);
      }
      return;
    }
    if (key.leftArrow || key.rightArrow || key.tab) {
      setSide((s) => (s === 'left' ? 'right' : 'left'));
      return;
    }
    if (key.return) {
      if (side === 'left') {
        setSide('right');          // 进这个工作区
        return;
      }
      const idx = originalIndex(rowsOfGroup[rIndex]);
      if (idx >= 0) onPick(idx);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setGroupIndex(0);
      setRowIndex(0);
      return;
    }
    // 可打印字符进筛选框（面板开着时输入行已卸载，所以这里自己收字符）
    if (input && input >= ' ' && input !== '\u007f') {
      setQuery((q) => q + input);
      setGroupIndex(0);
      setRowIndex(0);
    }
  });

  // 左栏宽度：够放"名字 + 条数"就行；右边留给会话（那一栏信息更多）
  const leftW = Math.max(16, Math.min(34, Math.floor(columns / 3)));
  const rightW = Math.max(10, columns - leftW - 1);
  const groupNameW = Math.max(4, leftW - 8);

  return (
    <Box flexDirection="column" width={columns}>
      {/* ① 标题行 */}
      <Box flexDirection="row">
        <Text color={color('text')}>{gstr(t(SESSION_MANAGER_KEYS.title))}</Text>
        <Text color={color('dim')}>{`  ${t(SESSION_MANAGER_KEYS.count, { n: all.length })}`}</Text>
      </Box>
      {/* ② 筛选行 */}
      <Box flexDirection="row">
        <Text color={color('accent')}>{`${gstr('❯')} `}</Text>
        <Text color={color('text')}>{truncateWidth(query, Math.max(4, columns - 14))}</Text>
        <Box flexGrow={1} />
        <Text color={color('dim')}>{String(filterSessions(all, query).length)}</Text>
      </Box>
      <Rule color={color} />

      {/* ③ 双栏 */}
      <Box flexDirection="row">
        <Box flexDirection="column" width={leftW}>
          {/* 左栏表头（照上游：`工作区（18）`）—— 没有它，下面那一列数字不知道在数什么。
              按栏宽截断：不截的话窄终端上它会**折行**，左栏第一行就不再是表头（实测 60 列下折成两行）。 */}
          <Text color={color('dim')}>
            {truncateWidth(t(SESSION_MANAGER_KEYS.workspaces, { n: groups.length }), leftW)}
          </Text>
          {groups.length === 0 ? (
            <Text color={color('dim')}>{t(SESSION_MANAGER_KEYS.empty)}</Text>
          ) : null}
          {winLeft.hiddenAbove > 0 ? (
            <Text color={color('dim')}>{t(PICKER_KEYS.moreAbove, { n: winLeft.hiddenAbove })}</Text>
          ) : null}
          {groups.slice(winLeft.start, winLeft.end).map((g, i) => {
            const index = winLeft.start + i;
            return (
              <ListItem
                key={g.root}
                label={truncateWidth(g.name, groupNameW)}
                right={String(g.rows.length)}
                isFocused={side === 'left' && index === gIndex}
                isSelected={side === 'right' && index === gIndex}
                color={color}
                onClick={() => { setSide('left'); setGroupIndex(index); setRowIndex(0); }}
                onHover={() => { setSide('left'); setGroupIndex(index); }}
              />
            );
          })}
          {winLeft.hiddenBelow > 0 ? (
            <Text color={color('dim')}>{t(PICKER_KEYS.moreBelow, { n: winLeft.hiddenBelow })}</Text>
          ) : null}
        </Box>
        <Text color={color('dim')}>{gstr('│')}</Text>
        <Box flexDirection="column" width={rightW}>
          {rowsOfGroup.length === 0 ? (
            <Text color={color('dim')}>{t(SESSION_MANAGER_KEYS.empty)}</Text>
          ) : null}
          {winRight.hiddenAbove > 0 ? (
            <Text color={color('dim')}>{t(PICKER_KEYS.moreAbove, { n: winRight.hiddenAbove })}</Text>
          ) : null}
          {rowsOfGroup.slice(winRight.start, winRight.end).map((row, i) => {
            const index = winRight.start + i;
            const sub = [String(row.when ?? ''), truncateWidth(workspaceRoot(row.path), Math.max(4, rightW - 4))]
              .filter((x) => x !== '')
              .join(' · ');
            return (
              <ListItem
                key={`${row.path}#${index}`}
                label={truncateWidth(row.label || row.id || row.path, Math.max(4, rightW - 8))}
                description={sub}
                right={t('sessions_turns', { n: row.turns ?? 0 })}
                isFocused={side === 'right' && index === rIndex}
                color={color}
                onClick={() => onPick(originalIndex(row))}
                onHover={() => { setSide('right'); setRowIndex(index); }}
              />
            );
          })}
          {winRight.hiddenBelow > 0 ? (
            <Text color={color('dim')}>{t(PICKER_KEYS.moreBelow, { n: winRight.hiddenBelow })}</Text>
          ) : null}
        </Box>
      </Box>

      <Rule color={color} />
      {/* ⑤ 底部键位提示 */}
      <Text color={color('dim')}>{t(SESSION_MANAGER_KEYS.hint)}</Text>
    </Box>
  );
}
