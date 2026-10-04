/**
 * **选择器外壳** —— 命令选择 / 文件选择 / 多选确认共用同一个壳。
 *
 * ## 借鉴（dsh-TUI，MIT；只借交互与结构，不拷文件、不用它的评分）
 *
 * | 这里 | 上游落点 | 借的是什么 |
 * |---|---|---|
 * | 标题带计数 | `lib/types/components/CommandSuggestions.js:38`、`FileSuggestions.js:68` | 标题里带"共 N 项"（`sugg-count`），用户一眼知道候选有多少 |
 * | 上下裁剪脚注 | `CommandSuggestions.js:39-46`、`FileSuggestions.js:69-76` | 窗口被裁时如实说"上面/下面还有 N 项"，而不是闷掉 |
 * | 空态 | `lib/types/components/MigratePicker.js:23` | 0 项时画一句空态文案，而不是画一个空气泡 |
 * | 多选行 | `MigratePicker.js:28` | 行首 `[x]`/`[ ]` 复选框（ASCII，无色也读得出来） |
 * | 行高恒定 + 按行预算窗口 | `MigratePicker.js:19-22`、`lib/types/components/Select.js:10-20` | 见 `./window.ts` |
 * | 列表项三态 | `lib/types/components/design-system/ListItem.js`（我们这边对应 `components/design-system/containers.tsx` 的 `ListItem`） | `❯` 焦点 / `✓` 选中 / 说明行，标记列定宽不跳 |
 *
 * ## 差异（有意）
 *
 * 1. **评分不是它的**：候选排序由调用方决定，ace 的 `render/match.ts` 那套评分
 *    （完全相等 +5000 / 连续命中 +8 / 词边界 +6）**更强，保留我们的** —— 本组件只吃
 *    已排好序的 `items`，不自己算分（C 报告 §Q3 的结论）。
 * 2. **`Tab` 切多选**：上游补全菜单的 Tab 是"接受当前候选"，多选在
 *    `MigratePicker` 里是**空格**。这里按 ace 的选择器口径统一成 **Tab 切勾选**
 *    （`←/→`、空格留给上层别的语义），所以单选模式下 Tab **什么也不做**。
 * 3. **不画边框**：上游 `SuggestionCard` 是 `╭╮╰╯` 圆角卡；我们照 `docs/TUI-SWISS-SPEC.md`
 *    §1 第 2 条：标题 + **整宽细线** + 内容（复用 `design-system/Dialog`）。
 * 4. **无鼠标**：上游靠 fork-ink 的 `events/wheel-event` 做滚轮/点击行，上游 ink 没有
 *    （K3 §③ 附表）→ 这里只有键盘。
 *
 * ## 宽度
 *
 * 一律走 `design-system` 的 `useColumns(width)`（`width` prop ?? `TerminalSizeContext.columns` ?? 80）。
 * **不要**去找 `useStdout` —— 内核里没有这个 hook（`kernel.d.ts:89`）。
 */

import { Box, Text, useInput } from '../../../vendor/dsh-ink/kernel.js';
import React, { useMemo, useState } from 'react';

import { Dialog, ListItem, useColumns, type ColorFn } from '../design-system/index.js';
import { gstr } from '../../render/glyphs.js';
import { truncateWidth } from '../../render/text.js';
import { clampFocus, isGroupStart, moveFocus, pickerWindow, toggleKey, type PickerRow } from './window.js';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * 本组件用到的 i18n 键（**键名集中在这里，值由 `locales/{zh,en,ja}.json` 提供**）。
 *
 * 为什么写成常量而不是内联字面量：`test/i18n-complete.test.ts` 只扫**字面量**调用
 * `t('key')`，本波 `locales/*.json` 由另一位写手独占（约定：不许直接改），
 * 这 6 个键要先在代码里引用、由那边补齐。集中列在这里，补齐时一眼能数清楚。
 * 缺键时的降级是**显示键名本身**（`src/i18n.ts:87` 的既定口径），不会崩、不会空白。
 */
export const PICKER_KEYS = {
  /** 标题里的总数：「共 N 项」/「N items」。 */
  count: 'picker_count',
  /** 多选脚注：「已选 N 项」。 */
  selected: 'picker_selected',
  /** 空态：「没有可选项」。 */
  empty: 'picker_empty',
  /** 下裁剪脚注：「下面还有 N 项」。 */
  moreBelow: 'picker_more_below',
  /** 上裁剪脚注 —— **复用菜单已有的键**（同义同形，不另造一个）。 */
  moreAbove: 'menu_more_above',
  /** 单选脚注：键位说明。 */
  hintSingle: 'picker_hint_single',
  /** 多选脚注：键位说明。 */
  hintMulti: 'picker_hint_multi',
} as const;

export interface PickerItem {
  /** 稳定标识（确认时回传的是它，不是下标）。 */
  key: string;
  label: string;
  /** 第二行说明（可选）。给了就占 2 行，窗口会照实算。 */
  description?: string;
  /** 分组标题（**已翻译**）。 */
  group?: string;
}

export interface PickerResult {
  /** 焦点项的 key；空列表时没有这个字段。 */
  key?: string;
  /** 单选 = `[焦点项]`；多选 = 勾选集合（**按列表顺序**），一个没勾就回退成 `[焦点项]`。 */
  keys: string[];
  multi: boolean;
}

export interface PickerProps {
  /** 标题（已翻译）；计数由本组件追加。 */
  title: string;
  /** 候选（**调用方负责排序**，见文件头差异 ①）。 */
  items: readonly PickerItem[];
  t: Translate;
  color: ColorFn;
  onConfirm: (result: PickerResult) => void;
  onCancel: () => void;
  /** 多选模式：`Tab` 切勾选，`Enter` 提交勾选集合。 */
  multi?: boolean;
  /** 列表区可用**行数**（含说明行与组标题行）。默认 10。 */
  rows?: number;
  /** 宽度口径：`width` ?? `TerminalSizeContext.columns` ?? 80。 */
  width?: number;
  /** 初始标记 / 初始勾选（单选模式下只用来画 `✓`，不参与确认）。 */
  checkedKeys?: readonly string[];
  /** `false` 时不抢键（别的浮层开着的时候）。 */
  isActive?: boolean;
}

/** 组标题行：`-- 组名`。**不用 `─`** —— 规范 §1.2：`─` 的 East Asian Width 是 Ambiguous，GBK 下双宽会整列错位。 */
function groupLine(label: string, color: ColorFn): React.ReactElement {
  return <Text color={color('dim')}>{gstr(`  -- ${label}`)}</Text>;
}

export function Picker({
  title,
  items,
  t,
  color,
  onConfirm,
  onCancel,
  multi = false,
  rows = 10,
  width,
  checkedKeys,
  isActive = true,
}: PickerProps): React.ReactElement {
  const columns = useColumns(width);
  const [focus, setFocus] = useState(0);
  const [checked, setChecked] = useState<readonly string[]>(() => [...(checkedKeys ?? [])]);

  const count = items.length;
  const focusIndex = clampFocus(focus, count);
  const spec: PickerRow[] = useMemo(
    () => items.map((it) => ({ height: it.description ? 2 : 1, group: it.group })),
    [items],
  );
  const win = useMemo(() => pickerWindow(spec, focusIndex, rows), [spec, focusIndex, rows]);
  const visible = items.slice(win.start, win.end);
  /** 一屏能显示几项 —— PgUp/PgDn 就翻这么多（窗口是"行预算"，这里换算成项）。 */
  const page = Math.max(1, win.end - win.start);
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  const focused = items[focusIndex];

  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.upArrow) {
        setFocus((f) => moveFocus(f, -1, count));
        return;
      }
      if (key.downArrow) {
        setFocus((f) => moveFocus(f, 1, count));
        return;
      }
      if (key.pageUp) {
        setFocus((f) => moveFocus(f, -page, count));
        return;
      }
      if (key.pageDown) {
        setFocus((f) => moveFocus(f, page, count));
        return;
      }
      if (key.tab) {
        // 单选模式下 Tab 无事可做（见文件头差异 ②）：不确认、不移动。
        if (multi && focused) setChecked((cs) => toggleKey(cs, focused.key));
        return;
      }
      if (key.return) {
        // 空列表回车 = 没得选，什么都不回传（不是"空答案"，是"没发生"）。
        if (count === 0) return;
        const picked =
          multi && checked.length > 0 ? items.filter((it) => checkedSet.has(it.key)) : focused ? [focused] : [];
        onConfirm({ ...(focused ? { key: focused.key } : {}), keys: picked.map((it) => it.key), multi });
      }
    },
    { isActive },
  );

  // Dialog 的内容区 `paddingX={2}`，所以可用宽度 = 列数 − 4（上游 `cardContentWidth` 同口径，那边是 −4 因为两侧边框各占 2 列）。
  const contentWidth = Math.max(0, columns - 4);
  // ListItem 的标记列定宽 2，所以标签与说明各再减 2；说明行还额外缩进 2 列。
  const labelWidth = Math.max(1, contentWidth - 2);
  const descWidth = Math.max(1, contentWidth - 2);

  // 空槽用 `''` 而不是 `false`：`design-system` 的 `byline` 用 `String(p ?? '')` 过滤，
  // `false` 会变成字符串 "false" 留在脚注里（真踩到过，见报告）。`''` 才会被丢掉。
  const hints: string[] = [
    multi && checked.length > 0 ? t(PICKER_KEYS.selected, { n: checked.length }) : '',
    t(multi ? PICKER_KEYS.hintMulti : PICKER_KEYS.hintSingle),
  ];

  return (
    <Dialog
      title={count > 0 ? `${title} · ${t(PICKER_KEYS.count, { n: count })}` : title}
      color={color}
      hints={hints}
      {...(width === undefined ? {} : { width })}
    >
      {count === 0 ? (
        <Text color={color('dim')}>{t(PICKER_KEYS.empty)}</Text>
      ) : (
        <Box flexDirection="column">
          {win.hiddenAbove > 0 ? (
            <Text color={color('dim')}>{t(PICKER_KEYS.moreAbove, { n: win.hiddenAbove })}</Text>
          ) : null}
          {win.leadGroup !== undefined ? groupLine(win.leadGroup, color) : null}
          {visible.map((item, i) => {
            const index = win.start + i;
            // `[x] ` 占 4 列，标签预算照扣 —— 不扣的话长标签会被 Ink 自己折行，
            // 那一项就变成 2 行，而窗口是照 1 行算的（行预算当场失真）。
            const label = multi
              ? `${checkedSet.has(item.key) ? '[x]' : '[ ]'} ${truncateWidth(item.label, Math.max(1, labelWidth - 4))}`
              : truncateWidth(item.label, labelWidth);
            return (
              <Box key={item.key} flexDirection="column">
                {isGroupStart(spec, index) && item.group ? groupLine(item.group, color) : null}
                <ListItem
                  label={label}
                  {...(item.description ? { description: truncateWidth(item.description, descWidth) } : {})}
                  isFocused={index === focusIndex}
                  isSelected={!multi && checkedSet.has(item.key)}
                  color={color}
                />
              </Box>
            );
          })}
          {win.hiddenBelow > 0 ? (
            <Text color={color('dim')}>{t(PICKER_KEYS.moreBelow, { n: win.hiddenBelow })}</Text>
          ) : null}
        </Box>
      )}
    </Dialog>
  );
}
