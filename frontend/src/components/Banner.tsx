/**
 * 首屏横幅 —— **左 logo、右身份信息**。
 *
 * 这个结构 ACE 在 Python 侧本来就有（`ai_code.landing_lines` 里的
 * `ace_panel.side_by_side(logo, right)`），我在前端**漏搬了** ——
 * 只搬了下面的分区列表，把最上面那一眼整个跳过了。
 *
 * 右栏三行是这么排的（**信息层次：身份 → 环境 → 位置**）：
 *
 * ```
 *  ██╗  ██╗  ██████╗  ██████╗ ██╗  ██╗     HooH · 互  v1.0.0     ← 身份
 * ██║  ██║ ██╔═══██╗ ██╔═══██╗ ██║  ██║    deepseek-v4-flash · readonly  ← 环境（模型 · 权限）
 * ███████║ ██║   ██║ ██║   ██║ ███████║    ace                            ← 位置（在哪个目录）
 * ██╔══██║ ██║   ██║ ██║   ██║ ██╔══██║
 * ██║  ██║ ╚██████╔╝ ╚██████╔╝ ██║  ██║
 * ╚═╝  ╚═╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═╝
 * ```
 *
 * 后两行是照参考补的：**模型和目录是"一眼要确认"的东西**，藏在别的屏里就得去翻。
 * （ACE 自己的 `home_state()` 本来就提供这两个值，只是首屏没用上。）
 *
 * 对齐用 `displayWidth`（按**列**不按码点）—— 右栏是中文，
 * 用 `.length` 算会把整栏往右推。
 */

import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { gstr } from '../render/glyphs.js';
import { ACE_LOGO } from '../render/logo.js';
import { displayWidth, truncateWidth } from '../render/text.js';

export interface BannerProps {
  version?: string | undefined;
  model?: string | undefined;
  permission?: string | undefined;
  folder?: string | undefined;
  color: (token: string) => string | undefined;
  /** 可用列宽：不够时右栏截断（否则一折行整个面板就歪了）。 */
  width?: number;
}

/** logo 与右栏之间的空隙（与 Python 侧 `side_by_side` 的默认 gap 一致）。 */
const GAP = 3;

export function Banner({
  version,
  model,
  permission,
  folder,
  color,
  width = 100,
}: BannerProps): React.ReactElement {
  const lw = Math.max(...ACE_LOGO.map((l) => displayWidth(l)));

  // 右栏：身份 / 它是什么 / 环境 / 位置。空的不占行。
  const right: Array<{ text: string; token: string; bold?: boolean }> = [];
  right.push({
    text: `HooH · 互${version ? `  v${version}` : ''}`,
    token: 'text',
    bold: true,
  });
  const env = [model, permission].filter(Boolean).join(' · ');
  if (env) right.push({ text: env, token: 'info' });
  if (folder) right.push({ text: folder, token: 'accent' });

  const height = Math.max(ACE_LOGO.length, right.length);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {Array.from({ length: height }, (_, i) => {
        const logoLine = ACE_LOGO[i] ?? '';
        const r = right[i];
        // 先补到 logo 最宽行，再加 gap —— 与 `side_by_side` 逐条一致
        const pad = ' '.repeat(Math.max(0, lw - displayWidth(logoLine) + GAP));
        // 右栏按剩余列宽截断：多一列就可能触发终端折行，一折整个面板就歪。
        // 必须走 `truncateWidth`（按**列**算，中文两列）—— 曾经用 `[...text].slice()`
        // 按码点截，folder 这类中文值一进右栏就超出预算，正是要防的那种折行。
        // budget ≤ 0 时交给 `truncateWidth` 返回空串（它自己处理 limit<=0），
        // 否则极端窄终端上"不截断"反而是最长的那一行。
        const budget = Math.max(0, width - lw - GAP - 2);
        const text = truncateWidth(r?.text ?? '', budget);
        return (
          <Text key={i}>
            {/* logo 用 `cyan`（`info` 在深色主题下就是 cyan）—— 与 HooH 的 Python 首屏
                一致（那边 `landing_lines` 里写的是 `c("cyan", ...)`）。
                第一版我用的是 `accent`（= ansiyellow），渲染成橄榄绿 —— 那不是这里的颜色。 */}
            {/* logo 是块状字符（`█╗╔╝╚═║`）—— 多数控制台画得出，但过一遍 `gstr` 不亏：
                画不出的终端上，装饰变成一串方框比变成 ASCII 更难解释 */}
            <Text color={color('info')}>{gstr(logoLine)}</Text>
            <Text>{pad}</Text>
            {r && text ? (
              <Text color={color(r.token)} bold={r.bold}>
                {text}
              </Text>
            ) : null}
          </Text>
        );
      })}
    </Box>
  );
}
