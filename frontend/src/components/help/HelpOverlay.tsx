/**
 * 帮助总览屏 —— 借鉴 dsh-TUI `components/HelpMenu.js` 的形态（三栏 = 动作 / 保留键 /
 * 命令列，窄屏 <72 列塌成一列，列头 + 整宽细线的版式）。真源与借鉴对象各管各的：
 *
 *   ①键位动作 ＝ `keys/registry.ts` 的 `KEY_ACTIONS`（键用 `effectiveComboDisplay`，
 *     说明走根字典：`t(spec.i18nKey)`）；
 *   ②保留键 ＝ `RESERVED_BINDINGS`，每条自带"保护的动作"标记（`help_ov_reserved_mark`）；
 *   ③斜杠命令 ＝ serve 握手下发的 `commands`（name → desc_key）+ `groups`
 *     （name → group i18n 键，来自 `COMMAND_GROUPS`）—— **分组顺序就是握手的顺序**，
 *     组标题在"组变了"时插一行，前端不自己猜（这是 Python 侧注释钦定的口径）。
 *
 * 组件自己的界面词（列头/提示）走本目录 `i18n.ts`（不进根 locales，整合波另有人收编）。
 *
 * 滚动没用现成的 `tui/scroll-box.tsx`：那是**跟随尾部**的转录语义（贴底、新内容拽走），
 * 帮助屏要的是从头读 + ↑↓ 选中行随窗口走；语义不同，各写各的小窗口（十来行）。
 * ponytail: 选中行只给 `❯` 标记，没做反显整行 —— 要纯瑞士口径时把 marker 列换成 inverse。
 */

import React from 'react';

import { Box, Text, useInput } from '../../../vendor/dsh-ink/kernel.js';
import {
  KEY_ACTIONS,
  RESERVED_BINDINGS,
  comboDisplay,
  effectiveComboDisplay,
} from '../../keys/registry.js';
import { g } from '../../render/glyphs.js';
import { displayWidth, truncateWidth } from '../../render/text.js';
import { Byline, Divider, useColumns, type ColorFn } from '../design-system/index.js';
import { HELP_KEYS, helpT } from './i18n.js';

export type HelpKeyFn = (key: string, params?: Record<string, string | number>) => string;

/** 握手下发的那两份表（`serve` 的 `commands` / `command_groups`）。 */
export interface HelpMenuData {
  /** 命令名 → 说明 i18n 键（顺序即分组顺序）。 */
  readonly commands: Readonly<Record<string, string>>;
  /** 命令名 → 分组 i18n 键（可缺省：缺省＝不分组，一列平铺）。 */
  readonly groups?: Readonly<Record<string, string>>;
}

export interface HelpOverlayProps {
  /** 根字典翻译器（action / 保留键 / 命令说明 / 组名都走它；缺键会露键名）。 */
  readonly t: HelpKeyFn;
  readonly menu: HelpMenuData;
  /** 组件自身文案的语言（默认 zh）。 */
  readonly lang?: string;
  readonly width?: number;
  readonly height?: number;
  readonly color?: ColorFn;
  /** Esc / q 都会触发。 */
  readonly onClose: () => void;
  /** 置 false 时整屏不抢键盘（外层对话框并存时用）。 */
  readonly active?: boolean;
}

interface CmdRow {
  readonly kind: 'group' | 'cmd';
  readonly text: string;
}

/** 键位/保留键共用的"左键右说明"行；列宽按显示宽度对齐，超出截断。 */
function KeyRow({
  combo,
  label,
  comboWidth,
  color,
}: {
  combo: string;
  label: string;
  comboWidth: number;
  color?: ColorFn;
}): React.ReactElement {
  const pad = ' '.repeat(Math.max(0, comboWidth - displayWidth(combo)) + 2);
  return (
    <Box>
      <Text wrap="truncate-end" color={color?.('text')}>
        {combo + pad}
      </Text>
      <Text wrap="truncate-end" color={color?.('dim')}>
        {label}
      </Text>
    </Box>
  );
}

export function HelpOverlay({
  t,
  menu,
  lang,
  width,
  height,
  color,
  onClose,
  active = true,
}: HelpOverlayProps): React.ReactElement {
  const cols = useColumns(width);
  const inner = Math.max(20, cols - 4); // 页边距 2+2（TUI-SWISS-SPEC §2）

  // 缺键回退：根字典里没有该键时落回英文 id（比 `key_word_left` 这种键名可读）。
  const descOf = (key: string, fallback: string): string => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  const actions = KEY_ACTIONS.map((sp) => ({
    combo: effectiveComboDisplay(sp.id),
    label: descOf(sp.i18nKey, sp.id),
  }));
  // 保留键行：列头已写"不许改"，行内只放说明（保护的动作名太长，塞进来会把命令列挤没）。
  const reserved = RESERVED_BINDINGS.map((b) => ({
    combo: comboDisplay(b.combo),
    label: descOf(b.i18nKey, b.action),
  }));
  const comboWidth =
    Math.max(0, ...actions.map((a) => displayWidth(a.combo)), ...reserved.map((r) => displayWidth(r.combo)));

  // ③ 命令列：按握手顺序排，组名变化处插一行组标题。
  const rows: CmdRow[] = [];
  let prevGroup: string | undefined;
  for (const [name, key] of Object.entries(menu.commands)) {
    const grp = menu.groups?.[name];
    if (grp !== undefined && grp !== prevGroup) {
      rows.push({ kind: 'group', text: descOf(grp, grp) });
      prevGroup = grp;
    }
    rows.push({ kind: 'cmd', text: `/${name}  ${descOf(key, name)}` });
  }
  const cmdIndices = rows.flatMap((r, i) => (r.kind === 'cmd' ? [i] : []));

  const [selPos, setSelPos] = React.useState(0);
  const [top, setTop] = React.useState(0);
  const fixedRows = 4; // 细线标题 + 列头 + 底行 byline + 呼吸
  const viewH = Math.max(2, (height ?? 24) - fixedRows);

  const move = (delta: number): void => {
    if (cmdIndices.length === 0) return;
    const pos = Math.min(cmdIndices.length - 1, Math.max(0, selPos + delta));
    const idx = cmdIndices[pos]!;
    setSelPos(pos);
    setTop(idx < top ? idx : idx >= top + viewH ? idx - viewH + 1 : top);
  };
  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        onClose();
        return;
      }
      if (key.upArrow) move(-1);
      else if (key.downArrow) move(1);
      else if (key.pageUp) move(-(viewH - 1 || 1));
      else if (key.pageDown) move(viewH - 1 || 1);
    },
    { isActive: active },
  );

  // 两列键位列宽按内容取但有封顶（说明在列宽内截断，不许把命令列挤没）；
  // 命令列吃剩余宽度。
  const rowW = (rs: readonly { label: string }[]): number =>
    Math.max(8, ...rs.map((r) => comboWidth + 2 + displayWidth(r.label)));
  const keysW = Math.min(30, rowW(actions));
  const reservedW = Math.min(26, rowW(reserved));
  const compact = cols < 72;
  const cmdColW = compact ? Math.max(keysW, reservedW) : Math.max(12, inner - keysW - reservedW - 4);

  const markerW = 2;
  const visible = rows.slice(top, top + viewH);
  const commandsCol = (
    <Box flexDirection="column" width={cmdColW} flexGrow={1} flexShrink={1}>
      <Text color={color?.('dim')}>{helpT(lang, HELP_KEYS.colCommands)}</Text>
      {rows.length === 0 ? (
        <Text color={color?.('dim')}>{helpT(lang, HELP_KEYS.noCommands)}</Text>
      ) : (
        visible.map((r, i) => {
          const idx = top + i;
          const sel = r.kind === 'cmd' && cmdIndices[selPos] === idx;
          return (
            <Box key={idx} flexDirection="row">
              <Box width={markerW}>
                <Text color={sel ? color?.('accent') : undefined}>{g(sel ? '❯' : ' ')}</Text>
              </Box>
              {r.kind === 'group' ? (
                <Text bold wrap="truncate-end" color={color?.('text')}>
                  {r.text}
                </Text>
              ) : (
                <Text wrap="truncate-end" color={sel ? color?.('text') : color?.('dim')}>
                  {truncateWidth(r.text, cmdColW - markerW)}
                </Text>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );

  const keysCol = (
    <Box flexDirection="column" width={keysW} flexShrink={0}>
      <Text color={color?.('dim')}>{helpT(lang, HELP_KEYS.colKeys)}</Text>
      {actions.map((a) => (
        <KeyRow key={a.combo} combo={a.combo} label={a.label} comboWidth={comboWidth} color={color} />
      ))}
    </Box>
  );
  const reservedCol = (
    <Box flexDirection="column" width={reservedW} flexShrink={0}>
      <Text color={color?.('dim')}>{helpT(lang, HELP_KEYS.colReserved)}</Text>
      {reserved.map((r, i) => (
        // 保留键的 combo 可能和别条同写法（ctrl+c 只有一处，但 key 要稳）：拼行号
        <KeyRow key={`${r.combo}-${i}`} combo={r.combo} label={r.label} comboWidth={comboWidth} color={color} />
      ))}
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={2} {...(height === undefined ? {} : { height })}>
      <Divider title={helpT(lang, HELP_KEYS.title)} width={inner} color={color} />
      {compact ? (
        <Box flexDirection="column">
          {keysCol}
          {reservedCol}
          {commandsCol}
        </Box>
      ) : (
        <Box flexDirection="row" gap={2} flexGrow={1} flexShrink={1}>
          {keysCol}
          {reservedCol}
          {commandsCol}
        </Box>
      )}
      <Byline parts={[helpT(lang, HELP_KEYS.closeHint), helpT(lang, HELP_KEYS.scrollHint)]} color={color} />
    </Box>
  );
}

export default HelpOverlay;
