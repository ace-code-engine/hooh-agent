/**
 * 补全菜单浮层 —— **两列对齐**：命令在左列，说明从固定列起。
 *
 * 为什么值得改成两列（而不是 `命令  说明` 内联）：内联排版下每行的说明起点都不一样，
 * 眼睛得逐行找起点才读得下去；两列一旦对齐，就是"扫一列命令 → 扫一列说明"，
 * 快得多。命令名恰好还都是**等宽的 ASCII**，对齐不会因为中英文混排而歪。
 *
 * 两条容易做错的事：
 *   1. **选中项必须始终可见**。只画"前 N 个"的话，用户按方向键往下走，光标就从屏幕上
 *      消失了 —— 而他只会觉得"方向键坏了"。`windowBounds` 保证它在窗口内，
 *      并在上下边缘如实说明被挡住多少。
 *   2. **说明列宽度要跟着终端变**。写死一个宽度，窄终端里说明会顶掉命令名，
 *      用户就只看到半句话。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';

import { Divider } from './design-system/index.js';
import React from 'react';

import { clampSelected, labelColumn, menuHintKey, windowBounds, type MenuState } from '../render/menu.js';
import { gstr } from '../render/glyphs.js';
import { padWidth, truncateWidth } from '../render/text.js';

export interface MenuProps {
  state: MenuState;
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  /** 最多显示多少行候选（不含提示行）。 */
  height?: number;
  /** 可用列宽。 */
  width?: number;
}

/** 选中标记占的列数（`▶ ` 或 `  `）。与 Python 的列表选中标记一致（R-8）。 */
const MARK_W = 2;

export function Menu({ state, t, color, height = 10, width = 80 }: MenuProps): React.ReactElement | null {
  if (!state.open || state.items.length === 0) return null;

  // **夹一次，两边都用它** —— 否则窗口绕着末项滚、标记却一个都不画（见 clampSelected）
  const sel = clampSelected(state);
  const { from, to, hiddenAbove, hiddenBelow } = windowBounds(state.items.length, sel, height);
  const shown = state.items.slice(from, to);

  // 命令列宽度：取自**当前窗口里最长的那个**，不取全表 —— 否则滚到底部时
  // 左侧会留一大片空白（因为最长的那个已经滚出去了）。规则本身在 `render/menu.labelColumn`，
  // 与 Python 的 `ui/ace_menu.desc_column` 同口径（`shell-parity.test.ts` 的 R-6 对拍）。
  const labelW = labelColumn(shown.map((i) => i.label));
  const descW = Math.max(0, width - MARK_W - labelW - 4);

  // **按显示宽度截断，不按码点**：说明是中文时，24 个汉字占 48 列，
  // 用 `.length` 判"放得下"会把说明顶出列宽预算，然后被 Ink 自己折行、把版面推歪。
  // 宽度口径复用 `render/text.js`（与 Python 的 `ui/ace_text` 同源、有码点差分测试）。
  const clip = (s: string, n: number): string => (n > 0 ? truncateWidth(s, n) : s);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 无边框（Swiss 规范 §1 第 2 条）：候选区与转录之间用**一条整宽细线**切开，
          不画四周的框 —— 框会让每一行都少 4 列，中文说明被挤得很窄。 */}
      <Divider color={color} />
      {hiddenAbove > 0 ? (
        <Text color={color('dim')}>{t('menu_more_above', { n: hiddenAbove })}</Text>
      ) : null}

      {shown.map((item, i) => {
        const index = from + i;
        const selected = index === sel;
        // 分组标题：**只在某组第一次出现时插一行**。
        //
        // 为什么不是"组变了就插"：候选顺序由引擎给（`grouped_commands()`），正常情况
        // 下同组是连着的；但**万一顺序被打乱**（组交错），"变了就插"会让同一个组标题
        // 反复出现（实测踩过：`group_session` 出现了两次、`/perm` 掉到 `/model` 后面）。
        // 按"首次出现"来插，至少不会出现重复标题这种一眼可见的错。
        //
        // 第一个可见项若是某组的第一条，也补标题 —— 否则从中间滚进来时
        // 用户不知道自己在看哪一组。
        const seen = new Set(shown.slice(0, i).map((x) => x.group));
        const showGroup = Boolean(item.group) && !seen.has(item.group);
        return (
          <Box key={item.label + index} flexDirection="column">
            {showGroup ? (
              <Text color={color('border')}>{'  ── ' + item.group}</Text>
            ) : null}
            <Text>
              <Text color={selected ? color('accent') : color('dim')}>
                {gstr(selected ? '▶ ' : '  ')}
              </Text>
              {/* 标签列按**显示列**补齐（`padWidth`），规则与 Python 的 `desc_column` 同源 */}
              <Text color={selected ? color('accent') : color('text')}>
                {padWidth(item.label, labelW)}
              </Text>
              {item.desc ? (
                <Text color={color('dim')}>{clip(item.desc, descW)}</Text>
              ) : null}
            </Text>
          </Box>
        );
      })}

      {hiddenBelow > 0 ? (
        <Text color={color('dim')}>{t('menu_more', { n: hiddenBelow })}</Text>
      ) : null}

      <Text color={color('dim')}>{t(menuHintKey(state))}</Text>
    </Box>
  );
}
