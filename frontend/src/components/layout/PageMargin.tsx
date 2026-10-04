/**
 * 版式几何 —— 「内容内缩」与「结构线出血」两个小原语。
 *
 * 借鉴对象是 `@deepseek-harness-tui/dsh-tui` v0.12.0（MIT）的
 * `lib/types/components/PageMargin.js`。**借的是几何，不是皮肤**：
 *
 *   ① **内容内缩**：根盒左右各留 `x` 列、上下各留 `y` 行，并把「终端尺寸」
 *      **收敛成「内容区尺寸」**往下传 —— 这样所有按列数排版的东西（折行、表格、
 *      定宽右对齐）拿到的就是内容宽，**各自不需要知道页边距存在**。
 *   ② **结构线出血**：版面级细线（分区线）直通终端左右边缘，而正文留在内容列里；
 *      这是常规排版的「内容列留边距、横线出血到版面边缘」。上游 v0.12.0 已把
 *      SRC 的 `SurfaceEdges` 并进 `PageMargin`，所以这里也是同一个文件里的两个
 *      原语，**不另开一层 context / 不做配置项**。
 *
 * 不借的：边框、背景填充、多色相、预设档位（`none/slim/roomy`）——
 * `docs/TUI-SWISS-SPEC.md` §1.2/§1.5/§1.3 明令禁止，页边距也只需要一档（规范 §2：2 cell）。
 *
 * 用法（`App.tsx` 就是这一档）：把整棵界面包进 `<PageMargin>`，需要「直通边缘」的
 * 结构线用 `<Rule>`；转录/卡片**内部**的线用 `<Rule bleed={false}>`（见下）。
 */

import { Box, TerminalSizeContext, Text } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { useColumns } from '../design-system/index.js';

/** 页边距（cell）：左右各 2 列、上下各 1 行 —— 规范 §2「页边距 2 cell」。 */
export const PAGE_INSET = { x: 2, y: 1 } as const;

/** 内容区相对终端原点的偏移（终端坐标 → 内容坐标的换算量）。 */
export interface PageInset {
  readonly x: number;
  readonly y: number;
}

/** 无 `PageMargin` 时恒为 `{ x: 0, y: 0 }` —— 直接渲染组件（测试 / preview）不受影响。 */
export const PageInsetContext = React.createContext<PageInset>({ x: 0, y: 0 });

/** 内容区相对终端原点的偏移。给需要「屏幕坐标」的东西换算用（出血线就是靠它）。 */
export function usePageInset(): PageInset {
  return React.useContext(PageInsetContext);
}

/**
 * 内容列宽 = 终端列数 - 两侧内缩。
 *
 * 抽成纯函数是**为了只有一条公式**：`PageMargin` 用它算内层尺寸，`App` 用它算
 * 那几个吃 `width` prop 的组件（横幅 / 状态行 / 输入行）的宽。各写一遍必漂。
 */
export function contentColumns(columns: number, x: number = PAGE_INSET.x): number {
  return Math.max(1, columns - 2 * x);
}

export interface PageMarginProps {
  children: React.ReactNode;
  /** 终端列数。不给就取 `TerminalSizeContext`（测试没有 Provider，落到 80）。 */
  width?: number;
  /** 左右内缩（列）。 */
  x?: number;
  /** 上下内缩（行）。 */
  y?: number;
}

/**
 * 根级页边距容器。渲染成 `paddingX/paddingY` 的根盒，并把内层
 * `TerminalSizeContext` **覆盖成扣减后的内容区尺寸**（这就是"内层不用自己知道边距"）。
 */
export function PageMargin({
  children,
  width,
  x = PAGE_INSET.x,
  y = PAGE_INSET.y,
}: PageMarginProps): React.ReactElement {
  const columns = useColumns(width); // prop ?? 终端列 ?? 80（全库唯一一条宽度规则）
  const rows = React.useContext(TerminalSizeContext)?.rows ?? 30;
  const inner = { columns: contentColumns(columns, x), rows: Math.max(1, rows - 2 * y) };
  return (
    <PageInsetContext.Provider value={{ x, y }}>
      <TerminalSizeContext.Provider value={inner}>
        <Box flexDirection="column" paddingX={x} paddingY={y}>
          {/* 内容盒必须给**数值宽**：ink 的百分比宽度按父盒（含 padding）解析，
              给 `width="100%"` 会宽出 2x（上游注释里记过这个坑）。 */}
          <Box flexDirection="column" width={inner.columns}>
            {children}
          </Box>
        </Box>
      </TerminalSizeContext.Provider>
    </PageInsetContext.Provider>
  );
}

export interface RuleProps {
  /** 线长（列，内容坐标）。不给 = 内容列宽。 */
  width?: number;
  /**
   * 出血：把线延伸到页边距外、直通终端左右边缘。**默认开**（版面级结构线）。
   *
   * 什么时候必须关：线所在的那个表面**右边还有内容**时 —— 全屏的滚动视口右边有
   * 1 列滚动条、卡片内部有自己的内容列。那种线上游的说法是「transcript 里的分隔线
   * 留在内容宽」，出血过去会压到别人的格子上（这正是"线在哪儿被内容打断"）。
   */
  bleed?: boolean;
  /** 线字符。默认 ASCII `-`：规范 §1.2 禁 `─`（Ambiguous，GBK 下双宽会整列错位）。 */
  char?: string;
  color?: (token: string) => string | undefined;
}

/**
 * 结构线 —— 整宽细线（不画边框、不铺背景，只有一条线，规范 §1.2/§1.5）。
 *
 * 出血靠**负 margin**：内容列宽 + 两侧内缩 = 终端宽，再左移一个内缩量回到原点。
 */
export function Rule({ width, bleed = true, char = '-', color }: RuleProps): React.ReactElement {
  const inset = usePageInset();
  const columns = useColumns(width);
  const extra = bleed ? inset.x : 0;
  const total = columns + 2 * extra;
  return (
    <Box width={total} marginLeft={-extra} flexShrink={0}>
      {/* `truncate-end`：万一被更窄的容器夹住（滚动视口右边那列滚动条），
          宁可**截断**也不能折成两行 —— 折了会挤歪按固定行高排的东西。 */}
      <Text color={color?.('border')} wrap="truncate-end">
        {char.repeat(total)}
      </Text>
    </Box>
  );
}
