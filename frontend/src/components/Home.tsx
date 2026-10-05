/**
 * 主页 —— 会话区的**第一块**，不是独立全屏页。
 *
 * 这几条取舍来自 `docs/HOME-DESIGN.md`，都不是审美问题：
 *
 *   - **放在会话区里而不是独立页**：独立页要"进去—出来"两次切换，滚动还会丢。
 *     做成会话区第一块：进来先看见它，打字之后它自然滚上去。只在没有消息时渲染。
 *   - **分区标题用短句、不用图标**：图标在旧 conhost 里会渲染成方框（这条踩过）。
 *   - **每行右侧给当前值**：主页一半的价值在"现在是什么"。只写「联网思考」而不写
 *     当前是开还是关，用户还得去别处查。
 *   - **行尾括注怎么改**：发现成本要为零 —— 看到这一行就知道按哪个键。
 *
 * 内容（分区、顺序、哪些项可用）由引擎给（`ui/ace_home.build_home`），
 * 这里只负责画。文案是 i18n 键，前端自己查字典。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React from 'react';

import type { HomeData, HomeItem, HomeSection } from '../protocol/types.js';
import { displayWidth } from '../render/text.js';
import { permissionToken } from './StatusLine.js';

export interface HomeProps {
  home: HomeData;
  t: (key: string, params?: Record<string, string | number>) => string;
  color: (token: string) => string | undefined;
  width: number;
}

/** 值 → 语义 token：权限那几档沿用状态行同一套（只读蓝 / 可写黄 / 全权红）。 */
function valueToken(item: HomeItem): string {
  if (item.label_key.includes('permission') && item.value) {
    return permissionToken(item.value);
  }
  return 'accent';
}

function ItemRow({
  item,
  t,
  color,
  width,
}: {
  item: HomeItem;
  t: HomeProps['t'];
  color: HomeProps['color'];
  width: number;
}): React.ReactElement {
  // `fmt` 必须传进去：文案里有 `{when}`/`{turns}` 这类占位符，不传就原样打出来
  const label = t(item.label_key, item.fmt);
  const hint = item.hint_key ? t(item.hint_key) : '';
  const value = item.value ? t(item.value) || item.value : '';

  // **瑞士风格 §2「定宽右对齐列」是核心**：值右对齐到内容右缘，整列对齐、便于扫读。
  // 只在够宽、且标签与值之间容得下留白时启用；否则退化成左对齐（标签 值），
  // 窄终端里强行右对齐只会让值飘到右缘、和标签挤成一团。宽度按**显示宽度**算（CJK 双宽）。
  const indentW = 2;
  const labelW = displayWidth(label);
  const valueW = value ? displayWidth(value) : 0;
  const valueStart = width - valueW; // 值左缘（值右缘贴内容右缘）
  const labelEnd = indentW + labelW;
  const hintClean = hint.length ? `(${hint})` : '';
  const hintW = hint.length ? displayWidth(hintClean) : 0;
  const roomy = width >= 40 && valueW > 0 && valueStart - labelEnd >= 3;
  const hintStart = valueStart - 1 - hintW; // 括注与值之间留 1 格
  const showHint = hint.length > 0 && roomy && hintStart - labelEnd >= 1;
  const gap = Math.max(1, (showHint ? hintStart : valueStart) - labelEnd);

  return (
    <Text color={item.enabled ? color('text') : color('dim')}>
      {'  '}
      {label}
      {' '.repeat(gap)}
      {showHint ? (
        <Text color={color('dim')}>{hintClean}</Text>
      ) : null}
      {value ? (
        <Text color={color(valueToken(item))}>
          {showHint ? ' ' : ''}
          {value}
        </Text>
      ) : null}
    </Text>
  );
}

export function Home({ home, t, color, width }: HomeProps): React.ReactElement {
  // 这里**不再渲染顶行**（版本 · 模型 · 权限）。
  //
  // 那行原本对应 `ui/ace_home.title_line`，是 ACE 首屏的设计；但现在它上面多了
  // 「横幅」（logo + 身份 + 环境），两处会把同一件事说两遍 —— 首屏上重复一行
  // "一眼要确认"的信息，等于把真正的新东西挤下去。
  // 身份与环境归横幅，这里只留**能直接做的事**（分区与条目）。
  return (
    <Box flexDirection="column" marginBottom={1}>
      {(home.sections as HomeSection[]).map((sec) => (
        <Box key={sec.key} flexDirection="column" marginTop={1}>
          {/* 分区标题：短句，不放图标（旧 conhost 会把图标画成方框） */}
          <Text color={color('dim')}>{'  ' + t(sec.title_key)}</Text>
          {sec.items.map((it) => (
            <ItemRow key={it.action + it.label_key} item={it} t={t} color={color} width={width} />
          ))}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text color={color('dim')}>{'  ' + t('home_hint')}</Text>
      </Box>
    </Box>
  );
}
