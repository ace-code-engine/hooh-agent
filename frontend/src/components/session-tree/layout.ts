/**
 * 会话树的**排版算术**（纯函数，无 React、无颜色）—— 树几何与列宽都在这里，
 * 组件只负责把它们画出来。分开的理由：几何是最容易错、也最值得断言的部分
 * （缩进/连接符/定宽右对齐列），拿 `renderLines()` 逐帧去猜远比直接调函数贵。
 *
 * 缩进口径**借**了参考实现（每个层次 3 格：`│  ` 竖线、`├─ ` / `└─ ` 连接符）——
 * 这是终端树画法里少有的既有惯例，自己另发明一套只会让人多认一次。
 * 列宽/对齐口径则按本仓库的瑞士规范：编号与计数**定宽右对齐**（§2 表格对齐是核心）。
 */

import { windowBounds } from '../../render/menu.js';
import { displayWidth, padWidth, truncateWidth } from '../../render/text.js';

import type { SessionNode } from './types.js';

/** 一行的树位置：深度 + 该层是否收尾 + 各祖先层要不要画竖线。 */
export interface TreeRow {
  node: SessionNode;
  depth: number;
  isLast: boolean;
  /** `gutters[k]` = 第 `k` 层往下还有兄弟 ⇒ 那条竖线要接着画。长度 == `depth`。 */
  gutters: boolean[];
}

/**
 * 把乱的 `parent` 指针摊平成**有序的单行序列**（DFS，子节点按 seq）。
 *
 * 三条防御（会话日志是磁盘文件，坏数据是常态而不是例外）：
 *   - `parent` 指向不存在的 seq ⇒ 当根；
 *   - 环（A→B→A）⇒ 走不到的那些节点在最后**补成根**，每个节点最多出现一次 ——
 *     没有这一步，一个自指的条目就能让界面挂死；
 *   - 重复 seq 已在 `normalizeTree` 挡掉，这里再挡一次访问重复。
 */
export function flattenTree(nodes: SessionNode[]): TreeRow[] {
  const bySeq = new Map<number, SessionNode>();
  for (const n of nodes) if (!bySeq.has(n.seq)) bySeq.set(n.seq, n);

  const kids = new Map<number, number[]>();
  const roots: number[] = [];
  for (const n of nodes) {
    const p = n.parent > 0 && bySeq.has(n.parent) ? n.parent : 0;
    if (p === 0) {
      roots.push(n.seq);
      continue;
    }
    const list = kids.get(p) ?? [];
    list.push(n.seq);
    kids.set(p, list);
  }

  const rows: TreeRow[] = [];
  const seen = new Set<number>();
  const walk = (seq: number, depth: number, gutters: boolean[], isLast: boolean): void => {
    if (seen.has(seq)) return;
    const node = bySeq.get(seq);
    if (node === undefined) return;
    seen.add(seq);
    rows.push({ node, depth, isLast, gutters });
    const children = (kids.get(seq) ?? []).filter((s) => !seen.has(s));
    children.forEach((s, i) =>
      walk(s, depth + 1, [...gutters, i < children.length - 1], i === children.length - 1),
    );
  };

  roots.forEach((s, i) => walk(s, 0, [], i === roots.length - 1));
  // 环上/悬空的剩余节点：补成根画出来，别让它们静默消失（用户会以为日志丢了）
  for (const n of nodes) if (!seen.has(n.seq)) walk(n.seq, 0, [], true);
  return rows;
}

/** 该行缩进 + 连接符的字符串（`│  ├─ `）。深度 0 是空串。 */
export function treePrefix(row: TreeRow): string {
  const chars: string[] = [];
  for (let level = 0; level < row.depth - 1; level++) {
    chars.push(row.gutters[level] === true ? '│' : ' ', ' ', ' ');
  }
  if (row.depth > 0) chars.push(row.isLast ? '└' : '├', '─', ' ');
  return chars.join('');
}

/**
 * 缩进太宽时**砍掉最远的祖先**（左侧截断 + `…`）：近处的分叉几何比"这是从哪个根来的"重要。
 * 这些字符全是本文件自己拼的单宽字（`│├└─` 与空格），所以按字符数切等于按显示宽度切。
 */
export function clampPrefix(prefix: string, budget: number): string {
  if (prefix.length <= budget) return prefix;
  if (budget <= 1) return '…';
  return `…${prefix.slice(prefix.length - (budget - 1))}`;
}

/** 按显示宽度**右**对齐（`padWidth` 是左对齐；编号/计数一律右对齐 —— 规范 §2）。 */
export function padLeft(text: string, width: number): string {
  const s = String(text ?? '');
  const w = displayWidth(s);
  return w >= width ? s : ' '.repeat(width - w) + s;
}

/** 译文函数（组件把 `t` 透传进来，这里不碰 i18n 单例）。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * `kind` → 标签 key。**只认真的有生产者的两种**（`cli/ace_sessionlog.MESSAGE_KINDS`
 * 就是这两条）；认不出的返回空串 —— 宁可这一列空着，也不给一个猜的标签。
 * 前缀按 `/` 前的段比，防将来出现 `user/message/injected` 之类。
 */
export function kindLabel(kind: string, t: Translate): string {
  const head = String(kind ?? '').split('/')[0]?.trim().toLowerCase() ?? '';
  if (head === 'user') return t('stree_kind_user');
  if (head === 'assistant') return t('stree_kind_assistant');
  return '';
}

/** 轮次列文案；`turn` 缺席（0）时**整列不显示**，不用 seq 冒充。 */
export function turnLabel(turn: number, t: Translate): string {
  return turn > 0 ? t('sessions_turns', { n: turn }) : '';
}

export interface ColumnWidths {
  seq: number;
  kind: number;
  turn: number;
}

/** 三列定宽：各列取可见行里的最宽值（列不对齐就白定了，见规范 §2）。 */
export function columnWidths(rows: TreeRow[], t: Translate): ColumnWidths {
  const w = { seq: 0, kind: 0, turn: 0 };
  for (const row of rows) {
    w.seq = Math.max(w.seq, displayWidth(String(row.node.seq)));
    w.kind = Math.max(w.kind, displayWidth(kindLabel(row.node.kind, t)));
    w.turn = Math.max(w.turn, displayWidth(turnLabel(row.node.turn, t)));
  }
  return w;
}

/** 一行右侧的状态标记（当前头优先于末梢，两者互斥 ⇒ 预览列预算恒定）。 */
export function rowMark(node: SessionNode, tips: number[], activeHead: number, t: Translate): string {
  if (activeHead > 0 && node.seq === activeHead) return t('tree_active');
  if (tips.includes(node.seq)) return ` ${t('stree_tip')}`;
  return '';
}

/**
 * 一行的**元信息列**（不含标记列、缩进、摘要 —— 那三段由组件分段上色）。
 *
 * 信息层级（我们自己的取舍，逐列都有出处）：
 *   `seq`（身份，定宽右对齐）· `kind`（谁说的）· `轮次`（在哪一轮）
 * 上游那行还有"时间"列，**这里没有** —— 卡片 §3.7b 的节点形状里没有任何时间字段，
 * 没有生产者就不摆一个空列。
 *
 * 三列**定宽**由 `columnWidths()` 统一给：逐行各算各的必然对不齐（规范 §2）。
 */
export function rowHead(row: TreeRow, widths: ColumnWidths, t: Translate): string {
  const parts: string[] = [padLeft(String(row.node.seq), widths.seq)];
  // 标签列**左**对齐、编号/计数**右**对齐：文字列对齐起点，数字列对齐末位（规范 §2 的口径）
  if (widths.kind > 0) parts.push(padWidth(kindLabel(row.node.kind, t), widths.kind));
  if (widths.turn > 0) parts.push(padLeft(turnLabel(row.node.turn, t), widths.turn));
  return parts.join('  ');
}

/**
 * 左右分栏的一行（左边标题、右边计数）。
 *
 * 定宽右对齐读数是瑞士风格的核心手段（规范 §2），所以顶栏不用"两个词拼一起"那种写法：
 * 计数得钉在右边界上，换宽度时才不会跟着内容左右漂。
 */
export function spreadRow(left: string, right: string, width: number): string {
  const l = displayWidth(left);
  const r = displayWidth(right);
  if (l + r + 1 > width) return truncateWidth(`${left} ${right}`, Math.max(0, width));
  return `${left}${' '.repeat(width - l - r)}${right}`;
}

/** 焦点窗口：复用补全菜单那套**黏边不滑动**的窗口（`windowBounds`，R-5 已与 Python 对拍）。 */
export function visibleWindow(total: number, focus: number, height: number): {
  from: number;
  to: number;
  hiddenAbove: number;
  hiddenBelow: number;
} {
  return windowBounds(total, focus, height);
}
