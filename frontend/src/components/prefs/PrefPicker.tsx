/**
 * 偏好类选择器族（借鉴 dsh-TUI 的 `ColorPicker`/`ThemePicker`/`LangPicker`/`EffortSlider` 的交互，
 * 一页一页）—— **只借交互与几何，颜色和文案全是 HooH 的**，零上游品牌、零彩蛋。
 *
 * 绑定规矩：用我们的 `design-system` primitives；四件选择器**共用同一个 row 渲染器**
 * （不许一处选 `●`/另一处用 `⦿`）。
 */

import React from "react";

import { Box, Text, useInput } from "../../../vendor/dsh-ink/kernel.js";
import { displayWidth } from "../../render/text.js";
import { Byline, Divider, useColumns, type ColorFn } from "../design-system/primitives.js";
import { PREFS_KEYS, type PrefKey } from "./i18n.js";

export interface PrefOption {
  /** 唯一 id（给回调与测试看）。 */
  readonly id: string;
  /** 显示的文案（已由调用方完成本地化）。 */
  readonly label: string;
  /** 说明（选中文案的上一行；可为空） */
  readonly hint?: string;
  /** 是否当前生效（与本列的"选中"是两回事）。 */
  readonly current?: boolean;
}

export interface PrefPickerProps {
  readonly title: string;
  readonly items: readonly PrefOption[];
  readonly t: (key: PrefKey, params?: Record<string, string | number>) => string;
  readonly width?: number;
  readonly color?: ColorFn;
  readonly onPick: (id: string) => void;
  readonly onClose: () => void;
}

/** 共有那一行：选中 `●` / 未选 `○`，微弱说明在右（退化一列时占独行）。这条样式全段一致。 */
export function PrefRow({
  item,
  focused,
  current,
  comboWidth,
  color,
}: {
  item: PrefOption;
  focused: boolean;
  current: boolean;
  comboWidth: number;
  color?: ColorFn;
}) {
  const statusChar = current ? "●" : focused ? "◐" : "○";
  return (
    <Box>
      <Text color={color?.(current ? "accent" : focused ? "text" : "dim")}>
        {statusChar}
      </Text>
      <Text> </Text>
      <Text color={color?.(focused ? "accent" : "text")}>{item.label}</Text>
      {item.hint ? (
        <Text color={color?.("dim")}>{" ".repeat(Math.max(0, comboWidth - displayWidth(item.label)))}{item.hint}</Text>
      ) : null}
    </Box>
  );
}

/** 选择器本体：↑↓ 移动、1..N 直接跳、Enter 选定、Esc 关闭。 */
export function PrefPicker({
  title,
  items,
  t,
  width,
  color,
  onPick,
  onClose,
}: PrefPickerProps) {
  const cols = useColumns(width);
  const [focus, setFocus] = React.useState(0);
  const n = items.length;
  const [combo] = [Math.max(0, ...items.map((i) => displayWidth(i.label)))];
  const cur = items.findIndex((i) => i.current);

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) setFocus((f) => Math.max(0, f - 1));
    if (key.downArrow) setFocus((f) => Math.min(n - 1, f + 1));
    if (key.return) {
      const pick = items[focus];
      if (pick) onPick(pick.id);
      return;
    }
    // 直接按序号选定（响应 1..9）
    const num = Number(input);
    if (Number.isInteger(num) && num >= 1 && num <= items.length) {
      onPick(items[num - 1].id);
    }
  });

  return (
    <Box flexDirection="column" width={cols}>
      <Divider title={title} width={cols} color={color} />
      {items.map((item, i) => (
        <PrefRow
          key={item.id}
          item={item}
          focused={i === focus}
          current={i === cur}
          comboWidth={combo}
          color={color}
        />
      ))}
      <Byline parts={[t(PREFS_KEYS.hint), t(PREFS_KEYS.close)]} color={color} />
    </Box>
  );
}

export default PrefPicker;
