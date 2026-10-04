/**
 * 选择对话框 —— `choose` / `confirm` / `text` 三态合一。
 *
 * 为什么三态合一个组件：引擎侧它们走的是**同一条协议往返**（`choice_request`
 * → `choice.answer`），差别只在渲染。分成三个组件会让"拿不到答案怎么办"
 * 这条口径抄三遍 —— 而它必须是同一句：**默认否 / 取消**。
 *
 * `choose` 用与补全菜单**同一套模糊匹配**（`render/match.ts`）。引擎那边的选择器
 * 也是这一套，所以 `/model` 在菜单里和在选择框里排序一致。
 */

import { Box, Text, useInput } from '../../vendor/dsh-ink/kernel.js';

import { Divider } from './design-system/index.js';
import React, { useMemo, useState } from 'react';

import { gstr } from '../render/glyphs.js';
import { filterItems } from '../render/match.js';
import type { ChoiceKind } from '../protocol/types.js';

export type ChoiceAnswer = {
  values?: string[];
  accepted?: boolean;
  text?: string;
  cancelled?: boolean;
};

export interface ChoiceDialogProps {
  kind: ChoiceKind;
  title: string;
  options: string[];
  defaultValue: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  onAnswer: (answer: ChoiceAnswer) => void;
  disabled?: boolean;
  /** 最多显示几行候选。 */
  height?: number;
  /**
   * `text` 才有：**凭据输入，不许回显**（H-34a）。
   *
   * 引擎给的提示词里写着"输入时不显示"，而这里此前把键入的每个字符都画了出来 ——
   * 承诺与事实正好相反。带上这个标志后只画掩码。
   */
  secret?: boolean;
}

export function ChoiceDialog({
  kind,
  title,
  options,
  defaultValue,
  t,
  color,
  onAnswer,
  disabled = false,
  height = 10,
  secret = false,
}: ChoiceDialogProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  // 凭据步不预填默认值：预填本身就是一次回显（H-34a）
  const [text, setText] = useState(secret ? '' : defaultValue);

  const filtered = useMemo(() => {
    if (kind !== 'choose') return options;
    if (!query) return options;
    return filterItems(options, query).map((s) => options[s.index]!);
  }, [kind, options, query]);

  const sel = Math.max(0, Math.min(cursor, Math.max(0, filtered.length - 1)));

  // 窗口裁剪：选中项必须始终可见（与菜单同一条口径，见 render/menu.windowBounds）
  const from = Math.max(0, Math.min(sel - Math.floor(height / 2), Math.max(0, filtered.length - height)));
  const shown = filtered.slice(from, from + height);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.escape) {
        onAnswer({ cancelled: true });
        return;
      }

      if (kind === 'confirm') {
        // 默认否：只有明确的 y/回车**在选中"是"时**才算同意。
        // 关掉、超时、乱按 —— 一律不等于同意。
        if (input === 'y' || input === 'Y') {
          onAnswer({ accepted: true });
          return;
        }
        if (input === 'n' || input === 'N' || key.return) {
          onAnswer({ accepted: false });
        }
        return;
      }

      if (kind === 'text') {
        if (key.return) {
          onAnswer({ text });
          return;
        }
        if (key.backspace || key.delete) {
          setText((v) => v.slice(0, -1));
          return;
        }
        if (key.ctrl && input === 'u') {
          setText('');
          return;
        }
        if (input && !key.ctrl && !key.meta) setText((v) => v + input);
        return;
      }

      // choose
      if (key.upArrow) {
        setCursor((c) => (c - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => (c + 1) % Math.max(1, filtered.length));
        return;
      }
      if (key.return) {
        // P-10：命中 0 项却按回车 = 用户要输入一个列表里没有的值（"自己输入"）。
        // 此前 `picked` 是 undefined → 什么都不发生，自填值被静默吞掉。
        if (filtered.length === 0 && query.trim() !== '') {
          onAnswer({ values: [query] });
          return;
        }
        const picked = filtered[sel];
        if (picked !== undefined) onAnswer({ values: [picked] });
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        setCursor(0);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setQuery((q) => q + input);
        setCursor(0);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 无边框：标题 + 整宽细线（见 PermissionDialog 同款说明） */}
      <Text bold color={color('accent')}>
        {title}
      </Text>
      <Divider color={color} />

      {kind === 'choose' ? (
        <>
          <Text color={color('dim')}>
            {t('selector_query')} <Text color={color('text')}>{query}</Text>
            <Text color={color('accent')}>▌</Text>
          </Text>
          {shown.length === 0 ? (
            <Text color={color('dim')}>{t('selector_no_match')}</Text>
          ) : (
            shown.map((opt, i) => {
              const idx = from + i;
              const selected = idx === sel;
              return (
                <Text key={opt + idx} color={selected ? color('accent') : color('text')}>
                  {gstr(selected ? '▶ ' : '  ')}
                  {opt}
                </Text>
              );
            })
          )}
          {filtered.length > height ? (
            <Text color={color('dim')}>
              {t('menu_more', { n: filtered.length - Math.min(height, filtered.length) })}
            </Text>
          ) : null}
        </>
      ) : null}

      {kind === 'text' ? (
        <Text>
          {/* 凭据只画掩码：长度仍是用户自己输入的长度，看不出内容 */}
          <Text color={color('text')}>
            {secret ? gstr('•').repeat(text.length) : text}
          </Text>
          <Text color={color('accent')}>{gstr('▌')}</Text>
        </Text>
      ) : null}

      {kind === 'confirm' ? (
        <Text color={color('dim')}>
          {t('confirm_yes')} / {t('confirm_no')}
        </Text>
      ) : null}

      <Text color={color('dim')}>
        {kind === 'text' ? t('choice_hint_text') : t('choice_hint_choose')}
      </Text>
    </Box>
  );
}
