/**
 * 账户余额卡 —— 借 `BalanceReportRow.js:16-59` 的**空态纪律**，不借数据源：
 *
 *   - ace 没有 `/cost`/余额接口（`.recon/Z-catalog.md` §C），所以这张卡的默认长相
 *     就是**显式"未接入"**：一条空态文案，一个数字都不编。
 *   - 给了数据（未来 provider 接入后）才逐币种画 `t(balLine)`：
 *     `{currency} {total}（赠送 … · 充值 …）`；缺 `granted`/`toppedUp` 就只画
 *     `{currency} {total}` —— 缺字段显示缺字段，不补 0。
 *   - 结构照面板的通用骨架：`Divider` 标题线 + 内容行（复用 design-system，不再造一个）。
 */

import { Box, Text } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { Divider, type ColorFn } from '../design-system/index.js';
import { truncateWidth } from '../../render/text.js';
import { USAGE_KEYS } from './i18n.js';
import type { Translate } from './ContextBar.js';

export interface BalanceEntry {
  readonly currency: string;
  readonly total: number;
  readonly granted?: number | null;
  readonly toppedUp?: number | null;
}

export interface BalanceCardProps {
  /** 余额明细；未接/空数组 → "未接入"空态。 */
  balances?: readonly BalanceEntry[] | null;
  t: Translate;
  color?: ColorFn;
  width?: number;
}

export function BalanceCard({ balances, t, color, width }: BalanceCardProps): React.ReactElement {
  const valid = (balances ?? []).filter(
    (b) => b && typeof b.currency === 'string' && b.currency.trim() !== '' &&
      typeof b.total === 'number' && Number.isFinite(b.total),
  );
  const line = (b: BalanceEntry): string => {
    if (typeof b.granted === 'number' && typeof b.toppedUp === 'number') {
      return t(USAGE_KEYS.balLine, {
        currency: b.currency,
        total: b.total.toFixed(2),
        granted: b.granted.toFixed(2),
        toppedUp: b.toppedUp.toFixed(2),
      });
    }
    return `${b.currency} ${b.total.toFixed(2)}`;
  };
  return (
    <Box flexDirection="column" width={width}>
      <Divider title={t(USAGE_KEYS.balTitle)} color={color} width={width} />
      {valid.length === 0 ? (
        <Text color={color?.('dim')}>{t(USAGE_KEYS.balEmpty)}</Text>
      ) : (
        valid.map((b, i) => (
          <Text key={`${b.currency}:${i}`} wrap="truncate">
            {truncateWidth(line(b), width ?? 80)}
          </Text>
        ))
      )}
    </Box>
  );
}
