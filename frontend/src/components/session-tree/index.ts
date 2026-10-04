/** 会话树屏的出口 —— 组件 + 形状 + 纯几何（接线层只从这一个口进货）。 */

export { SessionTree, type SessionTreeProps } from './SessionTree.js';
export {
  clampPrefix,
  columnWidths,
  flattenTree,
  kindLabel,
  padLeft,
  rowHead,
  rowMark,
  spreadRow,
  treePrefix,
  turnLabel,
  visibleWindow,
  type ColumnWidths,
  type Translate,
  type TreeRow,
} from './layout.js';
export { emptyTree, normalizeTree, type SessionNode, type SessionTreeData } from './types.js';
