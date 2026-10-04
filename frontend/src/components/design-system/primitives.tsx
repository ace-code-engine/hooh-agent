/**
 * 设计系统 · 小原语（照 Claude Code `components/design-system/` 的**目录结构与语义**，
 * 实现是自己的）。这一层解决的是"同一件小事三处长三个样"：
 * 分隔线、状态图标、进度条、byline、快捷键提示 —— 每个界面都要用，各写一遍必然漂。
 *
 * 与 Python 侧 `ui/ace_widgets.py` **逐条对应**（那边是终端，这边是 Ink 前端），
 * 关键算法刻意写成同形，`test/design-parity.test.ts` 会拿真 Python 对拍。
 */

import { TerminalSizeContext, Text } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { displayWidth, truncateWidth } from '../../render/text.js';

export type ColorFn = (token: string) => string | undefined;

/**
 * 宽度来源 —— **全库唯一一条规则**：`width` prop ?? `TerminalSizeContext` ?? 80。
 *
 * - 真实树：内核的 `<App>` 自带 `TerminalSizeContext.Provider`（`components/app.js`），
 *   所以不传 prop 也能拿到真实列宽，窗口缩放跟着变。
 * - 直接渲染（测试的 `renderLines` / `renderToScreen`、`tools/preview`）：没有 Provider，
 *   落到 `width` prop，再落到 80 —— **不会抛错、不会空屏**。
 *
 * 刻意**不用** `useTerminalSize()`：它没有 Provider 就抛错，而内核的
 * `renderToScreen` 会把错误吞成**空屏且零报错**（S1 §3）。宁可要一个明确的 80。
 */
export function useColumns(width?: number): number {
  const size = React.useContext(TerminalSizeContext);
  return width ?? size?.columns ?? 80;
}

// ─────────────────────────────────────────────────────────── Divider

/**
 * 整宽分隔线；给了 `title` 就把它**居中嵌进线里**（`──── 状态 ────`）。
 *
 * 为什么不用固定长度（此前 markdown 那块是 `'─'.repeat(20)`）：宽终端上像"没画完"，
 * 窄终端上又可能溢出。宽度走 `useColumns()`（prop ?? 终端列宽 ?? 80）。
 */
export function Divider({
  title = '',
  char = '─',
  width,
  color,
}: {
  title?: string;
  char?: string;
  width?: number;
  color?: ColorFn;
}): React.ReactElement {
  const total = Math.max(8, useColumns(width));
  const label = title ? ` ${title.trim()} ` : '';
  if (!label) {
    return <Text color={color?.('border')}>{char.repeat(total)}</Text>;
  }
  // 中文占两列：一律按**显示宽度**算，不能用 `label.length`（码点数）——
  // `" 状态 "` 码点数是 4、显示宽度是 6，按码点数居中会算多 2 列，
  // 分隔线既不是整宽、左右也不对称（同 `ui/ace_widgets.divider`，那边用的是 `display_width`）。
  const lw = displayWidth(label);
  if (lw >= total) {
    // 标题比线还长：只留标题，别画负长度的线；截断也走显示宽度，绝不把中文劈成半个
    return <Text color={color?.('dim')}>{truncateWidth(title.trim(), total)}</Text>;
  }
  const room = total - lw;
  const left = Math.floor(room / 2);
  const right = room - left;
  return (
    <Text>
      <Text color={color?.('border')}>{char.repeat(left)}</Text>
      <Text color={color?.('dim')}>{label}</Text>
      <Text color={color?.('border')}>{char.repeat(right)}</Text>
    </Text>
  );
}

// ─────────────────────────────────────────────────────────── StatusIcon

/** 六态 → (图标, token)。与 `ui/ace_widgets.STATUS_ICONS` 同表。 */
export const STATUS_ICONS: Record<string, readonly [string, string]> = {
  success: ['✓', 'success'],
  error: ['✗', 'error'],
  warning: ['⚠', 'warn'],
  info: ['ℹ', 'info'],
  pending: ['○', 'dim'],
  loading: ['◌', 'tool_pending'],
};

const ALIASES: Record<string, string> = {
  ok: 'success', done: 'success', pass: 'success', passed: 'success',
  fail: 'error', failed: 'error', err: 'error', '400': 'error', '403': 'error', '404': 'error',
  warn: 'warning', '500': 'warning', '502': 'warning', '503': 'warning',
  note: 'info', notice: 'info',
  todo: 'queued', queued: 'pending', wait: 'pending', waiting: 'pending',
  run: 'loading', running: 'loading', working: 'loading', busy: 'loading',
};

/** 状态词 → (图标, token)；认不出的一律当 `pending`（**不猜成功**）。 */
export function statusIcon(state: string): readonly [string, string] {
  const key = String(state ?? '').trim().toLowerCase();
  const norm = STATUS_ICONS[key] ? key : ALIASES[key] ?? 'pending';
  return STATUS_ICONS[norm] ?? STATUS_ICONS.pending!;
}

/** 状态图标 + 可选尾随空格（照 CC `StatusIcon` 的 `withSpace`）。 */
export function StatusIcon({
  status,
  withSpace = false,
  color,
}: {
  status: string;
  withSpace?: boolean;
  color?: ColorFn;
}): React.ReactElement {
  const [icon, token] = statusIcon(status);
  return <Text color={color?.(token)}>{withSpace ? `${icon} ` : icon}</Text>;
}

// ─────────────────────────────────────────────────────────── ProgressBar

/** 八分之一块（照 CC `ProgressBar.BLOCKS`；与 `ui/ace_widgets.BLOCKS` 同表）。 */
export const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const;

/** 与 `ui/ace_widgets.progress_bar` 同算法的进度条（对拍测试盯着这里）。 */
export function progressBar(ratio: number, width: number, empty = '─'): string {
  const w = Math.max(1, Math.trunc(width));
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const filled = r * w;
  const whole = Math.floor(filled);
  let out = '█'.repeat(whole);
  if (whole < w) {
    const idx = Math.floor((filled - whole) * 8);
    if (idx > 0) {
      out += BLOCKS[idx] ?? ' ';
      out += empty.repeat(w - whole - 1);
    } else {
      // 余数正好 0：别再塞一个空子格（白扔一格，半满看着像 4/8 满）
      out += empty.repeat(w - whole);
    }
  }
  return out.slice(0, w);
}

export function ProgressBar({
  ratio,
  width,
  color,
}: {
  ratio: number;
  width: number;
  color?: ColorFn;
}): React.ReactElement {
  return <Text color={color?.('accent')}>{progressBar(ratio, width)}</Text>;
}

// ─────────────────────────────────────────────────────────── Byline

/** 元数据用 ` · ` 连（照 CC `Byline`）：空项自动丢，分隔符不出现在首尾。 */
export function byline(parts: Array<string | false | null | undefined>, sep = ' · '): string {
  return parts.map((p) => String(p ?? '')).filter((p) => p.trim()).join(sep);
}

export function Byline({
  parts,
  color,
  sep,
}: {
  parts: Array<string | false | null | undefined>;
  color?: ColorFn;
  sep?: string;
}): React.ReactElement {
  return <Text color={color?.('dim')}>{byline(parts, sep)}</Text>;
}

// ─────────────────────────────────────────────────────────── ShortcutHint

/** `key to action`；**语序交给 i18n**（中文不写 to）—— 与 Python 侧 `key_hint` 同口径。 */
export function ShortcutHint({
  keys,
  action,
  t,
  parens = false,
  bold = false,
  color,
}: {
  keys: string;
  action: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  parens?: boolean;
  bold?: boolean;
  color?: ColorFn;
}): React.ReactElement {
  const text = t('key_hint', { shortcut: keys, action });
  const body = parens ? `(${text})` : text;
  // 键名的位置由 i18n 决定（`{shortcut}` 不一定在开头），所以按 `indexOf` 定位切两段；
  // 不能拿 parens 之后的整串按 `keys.length` 硬切 —— 多出来的 `(` 会让切点整体后移，键名当场重复。
  const at = text.indexOf(keys);
  if (!bold || at < 0) return <Text color={color?.('dim')}>{body}</Text>;
  return (
    <Text color={color?.('dim')}>
      {parens ? '(' : ''}
      {text.slice(0, at)}
      <Text bold color={color?.('text')}>{keys}</Text>
      {text.slice(at + keys.length)}
      {parens ? ')' : ''}
    </Text>
  );
}
