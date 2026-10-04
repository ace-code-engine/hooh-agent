/**
 * 会话树屏 —— **同文件内的分支结构**（`/tree` 的界面版）。
 *
 * ## 数据不是"没有"，是"没接出去"
 *
 * 曾经判定这块屏"没有数据源"，实测推翻了：`cli/ace_sessionlog.py` 的 WP-5 entry 树
 * （`message_chain` / `branch_tips` / `active_head`）**今天就在用**（`/tree` 拿它渲染文本）。
 * 缺的只是协议面 —— 卡片 §3.7b 把它定成 `sessiontree.request`（引擎侧在做的活）。
 * 所以本组件按**已文档化的字段形状**写，并对缺字段做防御：没数据就显示明确的"暂无"，
 * 不崩、不空白。
 *
 * 真正无源的只有**跨文件 fork/clone 的父子关系**（`parent_session` 只在内存里，
 * 没落日志）⇒ 那一行如实标"暂无"，不拿同文件的分支假装血缘。
 *
 * ## 动作不新增协议方法
 *
 * `Enter` 只发**引擎今天就有**的两条命令（卡片 §3.7b：切分支复用 `command.exec`）：
 *   - 末梢节点 → `/tree <编号>`（编号 = `tips` 数组下标 + 1，与 `branch_tips()` 同序）；
 *   - 中间节点 → `/tree @<轮次>`（跳到该轮末尾，继续写就从那里长新分支）；
 *   - 两者都没有（引擎没给轮次）⇒ **不发命令**（盲发一条切不动分支的命令只会骗人）。
 *
 * ## 与参考实现的关系
 *
 * 借的是**信息层级与键位**（每行显示什么、↑↓/Enter/Esc 三件套、缩进连接符），
 * 实现是按本仓库的设计系统与规范重写的：无边框（`Pane` + 整宽细线）、
 * 定宽右对齐列、选中**反显**而不是铺底色、宽度一律走 `useColumns()`。
 * 没搬的是它的搜索框、点击/滚轮、菜单座与确认座（上游靠 fork-ink 的鼠标事件；
 * 本仓库降级为纯键盘，见 `.recon/K3-screen-map.md` §③）。
 */

import { Box, Text, useInput } from '../../../vendor/dsh-ink/kernel.js';
import React from 'react';

import { gstr } from '../../render/glyphs.js';
import { displayWidth, truncateWidth } from '../../render/text.js';
import { Pane, useColumns } from '../design-system/index.js';
import {
  clampPrefix,
  columnWidths,
  flattenTree,
  rowHead,
  rowMark,
  spreadRow,
  treePrefix,
  visibleWindow,
  type Translate,
  type TreeRow,
} from './layout.js';
import { normalizeTree, type SessionNode, type SessionTreeData } from './types.js';

export interface SessionTreeProps {
  /** 引擎 `sessiontree.request` 的响应原文；`null` / 缺字段都走空态。 */
  data?: unknown;
  t: Translate;
  color: (token: string) => string | undefined;
  /** 可用列宽；缺省取 `TerminalSizeContext` 再缺省 80。 */
  width?: number;
  /** 树本体最多画几行（不含标题/细线/计数/提示）。 */
  height?: number;
  /** 正在取数据（引擎还没回）——与"确实是空的"分开显示，别把等待说成没有。 */
  loading?: boolean;
  /** `Enter`：给出选中节点与**可直接发给 `command.exec` 的一行**。 */
  onSelect?: (node: SessionNode, line: string) => void;
  /** `Esc`：退出本屏（由调用方决定退到哪）。 */
  onClose?: () => void;
}

/** 焦点标记占的列数：`❯ ` / `  `（定宽，有没有焦点文字都不跳）。 */
const MARK_W = 2;

export function SessionTree({
  data,
  t,
  color,
  width,
  height = 12,
  loading = false,
  onSelect,
  onClose,
}: SessionTreeProps): React.ReactElement {
  const cols = useColumns(width);
  const tree: SessionTreeData = React.useMemo(() => normalizeTree(data), [data]);
  const rows: TreeRow[] = React.useMemo(() => flattenTree(tree.nodes), [tree.nodes]);

  const [focus, setFocus] = React.useState(0);
  const focusIndex = rows.length === 0 ? 0 : Math.min(focus, rows.length - 1);

  // 起手把光标放在**当前分支头**上：这一屏是来看"我在哪"的，落在第一条上等于没说。
  // 找不到活跃头就回第一行 —— 不猜一个位置。
  React.useEffect(() => {
    const at = rows.findIndex((r) => r.node.seq === tree.activeHead && tree.activeHead > 0);
    setFocus(at >= 0 ? at : 0);
  }, [rows, tree.activeHead]);

  // 键盘走 ref：一次 stdin chunk 里可能挤进好几个按键，靠 state 闭包会漏掉中间那几次。
  const focusRef = React.useRef(focusIndex);
  focusRef.current = focusIndex;
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;

  const step = (by: 1 | -1): void => {
    const list = rowsRef.current;
    if (list.length === 0) return;
    // **不循环**：树有头有尾，转圈会让人分不清自己走到哪了（与补全菜单 R-5 同口径）。
    setFocus(Math.max(0, Math.min(focusRef.current + by, list.length - 1)));
  };

  /** 选中节点 → 一行命令（见文件头；两条命令都是引擎今天就有、并且**有回报**的）。 */
  const commandFor = (node: SessionNode): string => {
    const tipIndex = tree.tips.indexOf(node.seq);
    if (tipIndex >= 0) return `/tree ${tipIndex + 1}`;
    if (node.turn > 0) return `/tree @${node.turn}`;
    return '';
  };

  useInput((_input, key) => {
    if (key.escape) {
      onClose?.();
      return;
    }
    if (key.upArrow) {
      step(-1);
      return;
    }
    if (key.downArrow) {
      step(1);
      return;
    }
    if (key.return) {
      const row = rowsRef.current[focusRef.current];
      if (row === undefined) return;
      const line = commandFor(row.node);
      if (line !== '') onSelect?.(row.node, line);
    }
  });

  const lineBudget = Math.max(1, Math.trunc(height));
  const { from, to } = visibleWindow(rows.length, focusIndex, lineBudget);
  const shown = rows.slice(from, to);
  const widths = columnWidths(rows, t);

  const lineage = t('stree_lineage', { id: tree.parentSession !== '' ? tree.parentSession : t('stree_none') });
  const footer = (
    <Text color={color('dim')}>{t('stree_hint')}</Text>
  );

  const head = (
    <Text color={color('dim')}>
      {spreadRow(
        t('stree_tips', { n: tree.tips.length }),
        rows.length > 0 ? `${focusIndex + 1}/${rows.length}` : '0/0',
        cols,
      )}
    </Text>
  );

  /** 一行：标记列 + 缩进 + 元信息列(dim) + 摘要(默认前景) + **右对齐的状态列**。 */
  const renderRow = (row: TreeRow, index: number): React.ReactElement => {
    const focused = index + from === focusIndex;
    const isActive = tree.activeHead > 0 && row.node.seq === tree.activeHead;
    const suffix = rowMark(row.node, tree.tips, tree.activeHead, t);
    const meta = rowHead(row, widths, t);
    // 缩进先让位：窄终端里"这是哪一条"比"它挂在哪个祖先下"要紧，但**至少给摘要留 8 列** ——
    // 把连接符砍成 `…` 只省下一两列，却让整棵树变成一列省略号。
    const indentBudget = Math.max(0, cols - MARK_W - displayWidth(meta) - displayWidth(suffix) - 8);
    const prefix = clampPrefix(treePrefix(row), indentBudget);
    const used = MARK_W + displayWidth(prefix) + displayWidth(meta) + 2;
    const preview = truncateWidth(row.node.preview, Math.max(0, cols - used - displayWidth(suffix)));
    const body = preview === '' ? '' : `  ${preview}`;
    // 状态列钉在右边界上（规范 §2：计数/标记一律定宽右对齐）—— 不然「活跃」会随摘要长度
    // 左右浮，一屏里几个标记对不上一条线。
    const gap =
      suffix === '' ? '' : ' '.repeat(Math.max(1, cols - used - displayWidth(preview) - displayWidth(suffix)));
    const marker = focused ? '❯ ' : '  ';

    // 选中 = **整行反显**（规范 §3 的第五种层级手段），不是铺底色：
    // 反显交给终端自己的前景/背景对调，深浅色主题下都成立。
    // 整行**一个字符串子节点**：一次样式包裹，反显不会在片段之间被拆开。
    if (focused) {
      return (
        <Text key={row.node.seq} inverse bold>
          {gstr(`${marker}${prefix}${meta}${body}${gap}${suffix}`)}
        </Text>
      );
    }
    return (
      <Box key={row.node.seq} flexDirection="row">
        <Text color={color('dim')}>{gstr(`${marker}${prefix}`)}</Text>
        <Text color={color('dim')}>{meta}</Text>
        {body === '' ? null : <Text>{body}</Text>}
        <Text color={isActive ? color('accent') : color('dim')}>{gstr(`${gap}${suffix}`)}</Text>
      </Box>
    );
  };

  const body = (): React.ReactElement => {
    if (loading) {
      return <Text color={color('dim')}>{t('stree_loading')}</Text>;
    }
    if (shown.length === 0) {
      // 明确的空态：说清"没有数据"而不是画一屏空白让用户以为界面坏了。
      return <Text color={color('dim')}>{t('stree_empty')}</Text>;
    }
    return (
      <Box flexDirection="column">
        {shown.map((row, i) => renderRow(row, i))}
        {tree.single ? <Text color={color('dim')}>{t('tree_single')}</Text> : null}
      </Box>
    );
  };

  return (
    <Pane title={t('stree_title')} color={color} width={cols} footer={footer}>
      {loading ? null : head}
      <Text color={color('dim')}>{lineage}</Text>
      {body()}
    </Pane>
  );
}
