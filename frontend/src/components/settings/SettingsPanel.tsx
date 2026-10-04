/**
 * 设置面板 —— 声明式 schema 的渲染器 + 键盘。
 *
 * 借的是 `dsh-TUI`（MIT）`src/screens/Settings.tsx` 的**结构与交互口径**，不是它的文件：
 *
 *   1. **行规划与渲染共用一个函数**（`:48-60` 的 `rootRowsFor`）—— 焦点表和画面都从
 *      `schema.panelRows()` 派生，两边不可能对不上。
 *   2. **自动保存**（`:516-531`）：布尔/枚举改完立刻写回，文本回车即写，**没有"保存"键**；
 *      非法值留在编辑器里 + 错误徽标，Esc 只退出不丢弃。
 *   3. **键位**（`:547-575`）：↑↓ 焦点、←→ 循环选项、回车激活（进分组 / 切布尔 / 进编辑 / 提交文本）、
 *      Esc 退层（分组内先退一层再离开）。
 *   4. **行高恒为 1**（`:95-99` 的注释）：焦点移动不重排列表。
 *
 * 三处**我们自己加的**：
 *   - **设置内搜索**（上游 `C-interaction.md` §Q6「没有设置内搜索」）：`/` 开筛选，
 *     评分复用 `render/match.ts`（与补全菜单、选择器同一套），回车保留筛选、Esc 清空。
 *   - **`write_cmd` 模板写通道**：一切写动作都走注入的 `onWrite(command)`（调用方发
 *     `command.exec`）。没有模板的项**不当成可编辑**，底部明说"需在向导里改" ——
 *     点了没反应等于骗人（`DshShell-AceCapabilities.md` §3.7c）。
 *   - **凭据项不回显**：`secret` 项只显示"已设置 / 未设置"，编辑态也从不预填当前值。
 *
 * 视觉：`docs/TUI-SWISS-SPEC.md` —— 不画边框、分区用整宽细线、单强调色、值列定宽右对齐、
 * 宽度全部走 `useColumns()` 与 `render/text.ts` 的**显示宽度**（CJK 双宽）。
 */

// 内核 import 的形状照抄（ESM、`.js` 必须写、大小写照抄）。**只多一层 `..`**：
// 本文件在 `frontend/src/components/settings/`，`../../vendor` 会落到不存在的
// `frontend/src/vendor`（tsc TS2307），`../../../vendor` 才是 vendored 内核。
import { Box, Text, useInput } from '../../../vendor/dsh-ink/kernel.js';

import React, { useMemo, useState } from 'react';

import { Byline, Divider, useColumns, type ColorFn } from '../design-system/index.js';
import { gstr } from '../../render/glyphs.js';
import { windowBounds } from '../../render/menu.js';
import { displayWidth, padWidth, truncateWidth } from '../../render/text.js';
import {
  boolValue,
  checkDraft,
  cycleValue,
  editability,
  focusableRows,
  moveFocusId,
  PANEL_KEYS,
  panelRows,
  rowIndexOf,
  writeCommandFor,
  type PanelRow,
  type SettingItem,
  type SettingSection,
} from './schema.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface SettingsPanelProps {
  readonly sections: readonly SettingSection[];
  readonly t: Translate;
  /** 写通道：面板只生产命令行，**发不发由调用方定**（`command.exec`）。 */
  readonly onWrite: (command: string) => void;
  readonly color?: ColorFn;
  /** 根页 Esc 的出口（没有就给不了，面板不会自己消失）。 */
  readonly onClose?: () => void;
  readonly width?: number;
  /** 列表最多几行（不含标题/提示）。 */
  readonly height?: number;
  /** 直接落在某个 `page` 分组里（`/config <分组>` 那种入口）。 */
  readonly initialGroupId?: string;
  /** 挂载但让出键盘（审批弹框等抢焦点时用）。 */
  readonly disabled?: boolean;
}

interface Editing {
  readonly id: string;
  readonly draft: string;
  readonly error: boolean;
}

/** 值列右对齐（瑞士规范 §2 的"定宽右对齐列"）。 */
function rightAlign(text: string, width: number): string {
  const w = displayWidth(text);
  return w >= width ? text : ' '.repeat(width - w) + text;
}

/**
 * 一行里值列的内容。`editing` 非空表示这一行正在被编辑。
 *
 * **凭据项在编辑态也只画掩码**：长度看得见、内容看不见 —— 否则"输入时不显示"的承诺
 * 与事实正好相反（H-33/H-34a；同 `ChoiceDialog` 的 secret 分支）。
 */
function valueText(
  item: SettingItem,
  editing: Editing | undefined,
  t: Translate,
): string {
  if (editing !== undefined) {
    return item.secret
      ? `${gstr('•').repeat(editing.draft.length)}${gstr('▌')}`
      : `${editing.draft}${gstr('▌')}`;
  }
  if (item.secret) return item.isSet ? t(PANEL_KEYS.secretSet) : t(PANEL_KEYS.secretUnset);
  if (item.kind === 'unsupported') return t(PANEL_KEYS.unsupported);
  if (item.kind === 'boolean') return t(boolValue(item) ? 'arg_on' : 'arg_off');
  if (item.kind === 'enum') {
    const hit = item.options.find((o) => o.value === item.current);
    return hit === undefined ? (item.current ?? t(PANEL_KEYS.unset)) : t(hit.labelKey);
  }
  return item.current === undefined || item.current === '' ? t(PANEL_KEYS.unset) : item.current;
}

/** 值列右边的短徽标：只在**回车改不动**时才出现，省得用户白按。 */
function chipKey(item: SettingItem): string | undefined {
  const edit = editability(item);
  if (item.kind === 'unsupported' || edit === 'none') return PANEL_KEYS.chipReadonly;
  if (edit === 'wizard') return PANEL_KEYS.chipWizard;
  return undefined;
}

export function SettingsPanel({
  sections,
  t,
  onWrite,
  color,
  onClose,
  width,
  height = 12,
  initialGroupId,
  disabled = false,
}: SettingsPanelProps): React.ReactElement {
  const cols = useColumns(width);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(initialGroupId ?? null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const rows = useMemo(
    () => panelRows(sections, { groupId, query }, (key) => t(key)),
    [sections, groupId, query, t],
  );
  const focusables = useMemo(() => focusableRows(rows), [rows]);
  // 焦点用 **id** 而不是下标：筛选一变下标就失效，而 id 只会在那一行真的消失时失效。
  const focused = focusables.find((row) => row.id === focusId) ?? focusables[0];
  const focusedItem = focused?.kind === 'field' ? focused.item : undefined;
  const editingItem = editing === null
    ? undefined
    : focusables.find((row) => row.id === editing.id && row.kind === 'field');
  const editItem = editingItem?.kind === 'field' ? editingItem.item : undefined;

  const bounds = windowBounds(rows.length, rowIndexOf(rows, focused?.id ?? null), Math.max(1, height));
  const shown = rows.slice(bounds.from, bounds.to);

  // 值列宽度取自**当前窗口**（照 `render/menu.labelColumn` 的做法）：取全表的话，
  // 最长的那个滚出去以后左边会留一大片空白。
  const valueW = Math.max(
    4,
    Math.min(
      Math.max(0, ...shown.map((row) => (row.kind === 'field' ? displayWidth(valueText(row.item, editing?.id === row.id ? editing : undefined, t)) : 0))),
      Math.max(4, Math.floor(cols / 3)),
    ),
  );
  // 左栏（标记 2 列 + 文本 + 1 列间隙），值列紧贴右边缘 —— 徽标也算进左栏，
  // 否则带徽标的行会把值列顶出去（行宽一变，整列就歪了）。
  const leftW = Math.max(8, cols - 2 - valueW - 1);

  const move = (delta: number): void => setFocusId(moveFocusId(rows, focused?.id ?? null, delta));

  const commit = (item: SettingItem, value: string): void => {
    const cmd = writeCommandFor(item, value);
    // 没有模板 = 这条键今天没有对应命令（§3.7c 的已知上限）。**不静默吞掉**：底部已经写着
    // "需在向导里改"，这里再按一次也只是把人留在原地。
    if (cmd !== '') onWrite(cmd);
  };

  const cycle = (direction: 1 | -1): void => {
    if (focusedItem === undefined) return;
    const item = focusedItem;
    if (editability(item) !== 'direct') return; // 箭头在改不动的行上是无操作（同上游口径）
    const next = cycleValue(item, direction);
    if (next !== undefined) commit(item, next);
  };

  const activate = (row: PanelRow | undefined): void => {
    if (row === undefined) return;
    if (row.kind === 'header') return;
    if (row.kind === 'page') {
      setGroupId(row.group.id);
      setFocusId(null);
      setQuery('');
      setEditing(null);
      return;
    }
    const item = row.item;
    if (item.kind === 'unsupported') return;
    const edit = editability(item);
    if (edit === 'none') return;
    if (edit === 'wizard') {
      // 有命令但收不下值（如 `/config`）：发出去 = 打开向导，这是协议写明的降级路径。
      onWrite(item.writeCmd);
      return;
    }
    if (item.kind === 'boolean' || item.kind === 'enum') {
      cycle(1);
      return;
    }
    // 文本 / 数字：进编辑态。**凭据项不预填**（预填本身就是一次回显，H-34a）。
    setEditing({ id: row.id, draft: item.secret ? '' : item.current ?? '', error: false });
  };

  useInput(
    (input, key) => {
      if (disabled) return;

      if (editing !== null) {
        if (key.escape) {
          setEditing(null);
          return;
        }
        if (key.return) {
          if (editItem === undefined) {
            setEditing(null);
            return;
          }
          const check = checkDraft(editItem, editing.draft);
          if (!check.ok) {
            // 非法值不落库、编辑器不关（他们的自动保存口径 `Settings.tsx:516-531`）
            setEditing({ ...editing, error: true });
            return;
          }
          commit(editItem, check.value);
          setEditing(null);
          return;
        }
        if (key.backspace || key.delete) {
          setEditing((state) => (state === null ? null : { ...state, draft: state.draft.slice(0, -1), error: false }));
          return;
        }
        if (input && !key.ctrl && !key.meta && !key.return) {
          // 只收真字符：控制字节（含 `\r`/`\x1b` 残渣）不进草稿
          const typed = input.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
          if (typed !== '') {
            setEditing((state) => (state === null ? null : { ...state, draft: state.draft + typed, error: false }));
          }
        }
        return;
      }

      if (searching) {
        if (key.escape) {
          setSearching(false);
          setQuery('');
          return;
        }
        // 回车 = **收起输入、保留筛选**（然后 ↑↓/回车直接作用在结果上）
        if (key.return) {
          setSearching(false);
          return;
        }
        if (key.upArrow) {
          move(-1);
          return;
        }
        if (key.downArrow) {
          move(1);
          return;
        }
        if (key.backspace || key.delete) {
          setQuery((q) => q.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);
        return;
      }

      if (key.upArrow) {
        move(-1);
        return;
      }
      if (key.downArrow) {
        move(1);
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        cycle(key.rightArrow === true ? 1 : -1);
        return;
      }
      if (key.return) {
        activate(focused);
        return;
      }
      if (key.escape) {
        if (groupId !== null) {
          setGroupId(null);
          setFocusId(null);
          return;
        }
        if (query !== '') {
          setQuery('');
          return;
        }
        // 自动保存 ⇒ 没有"未保存的改动"可丢，Esc 就是离开（他们 `:572-574` 的原话）
        onClose?.();
        return;
      }
      if (input === '/') setSearching(true);
    },
    { isActive: !disabled },
  );

  const hints: Array<string | false> = [];
  if (editing !== null) {
    hints.push(t(PANEL_KEYS.hintEdit), editing.error && t(PANEL_KEYS.invalid));
  } else if (searching) {
    hints.push(t(PANEL_KEYS.hintSearch));
  } else {
    hints.push(t(PANEL_KEYS.hintList));
  }
  // 焦点落在"回车改不动"的行上时，底部**明说为什么** —— 点了没反应等于骗人（§3.7c）。
  if (focusedItem !== undefined && editability(focusedItem) !== 'direct') hints.push(t(PANEL_KEYS.noWrite));

  return (
    <Box flexDirection="column">
      {/* 无边框：标题 + 整宽细线（Swiss §1 第 2 条；同 PermissionDialog / ChoiceDialog）。
          线用 ASCII `-`：规范 §1.2 明令不用 `─`（East Asian Width = Ambiguous，GBK 下双宽，
          整列错位）。design-system 的 Divider 默认是 `─`，这里显式改掉。 */}
      <Text bold color={color?.('accent')}>
        {t(PANEL_KEYS.title)}
      </Text>
      <Divider char="-" color={color} />

      {searching || query !== '' ? (
        <Text color={color?.('dim')}>
          {`${t(PANEL_KEYS.searchLabel)} `}
          <Text color={color?.('text')}>{query}</Text>
          {searching ? <Text color={color?.('accent')}>{gstr('▌')}</Text> : null}
        </Text>
      ) : null}

      {rows.length === 0 ? (
        <Text color={color?.('dim')}>
          {t(query !== '' ? PANEL_KEYS.searchEmpty : PANEL_KEYS.empty)}
        </Text>
      ) : null}

      {bounds.hiddenAbove > 0 ? (
        <Text color={color?.('dim')}>{t('menu_more_above', { n: bounds.hiddenAbove })}</Text>
      ) : null}

      {shown.map((row) => {
        if (row.kind === 'header') {
          return (
            <Text key={row.id} color={color?.('dim')}>
              {'  '}
              {t(row.labelKey)}
            </Text>
          );
        }
        const isFocused = row.id === focused?.id;
        const marker = gstr(isFocused ? '❯ ' : '  ');
        if (row.kind === 'page') {
          // 分组导航行：标签 + 条目计数（不放箭头字形 —— `›` 不在引擎的下发降级表里）
          const label = `${truncateWidth(t(row.group.labelKey), Math.max(4, leftW - 6))}  (${row.count})`;
          return (
            <Text key={row.id}>
              <Text color={isFocused ? color?.('accent') : color?.('dim')}>{marker}</Text>
              <Text color={color?.('text')}>{padWidth(label, leftW)}</Text>
            </Text>
          );
        }
        const item = row.item;
        const isEditing = editing !== null && editing.id === row.id;
        const value = truncateWidth(valueText(item, isEditing ? editing : undefined, t), valueW);
        const chip = chipKey(item);
        const left = truncateWidth(
          chip === undefined ? t(item.labelKey) : `${t(item.labelKey)} [${t(chip)}]`,
          leftW,
        );
        return (
          <Text key={row.id}>
            <Text color={isFocused ? color?.('accent') : color?.('dim')}>{marker}</Text>
            <Text color={isFocused ? color?.('accent') : color?.('text')} bold={isFocused}>
              {padWidth(left, leftW)}
            </Text>
            <Text color={isEditing ? color?.('text') : color?.('dim')}>
              {rightAlign(value, valueW)}
            </Text>
          </Text>
        );
      })}

      {bounds.hiddenBelow > 0 ? (
        <Text color={color?.('dim')}>{t('menu_more', { n: bounds.hiddenBelow })}</Text>
      ) : null}

      <Byline parts={hints} color={color} />
    </Box>
  );
}
