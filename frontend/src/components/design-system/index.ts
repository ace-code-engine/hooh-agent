/**
 * 设计系统出口 —— 组件层只从这一个口进货。
 *
 * 为什么不各文件各导：这一层是"界面语言的唯一入口"，收敛成一个口以后
 * 换实现（比如以后 Divider 要支持更细的线型）只改这里，用的人不用动。
 */

export {
  BLOCKS,
  Byline,
  Divider,
  ProgressBar,
  ShortcutHint,
  StatusIcon,
  STATUS_ICONS,
  byline,
  progressBar,
  statusIcon,
  type ColorFn,
} from './primitives.js';
export { Dialog, ListItem, LoadingState, Pane, Tabs, type TabItem } from './containers.js';
