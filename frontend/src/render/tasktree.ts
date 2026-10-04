/**
 * 任务树渲染 —— 形状照抄 `ui/ace_layout.render_task_tree`。
 *
 * 字形与连接线逐条对齐那边：`·` 待办 / `▶` 进行中 / `✓` 完成 / `✗` 受阻，
 * 子节点用 `├─ ` / `└─ `，竖线用 `│  `。两套前端用不同的树形符号，用户会以为
 * 那是两种不同的状态。
 *
 * 一条容易做错的：**根节点不带连接线**，子节点的前缀由"自己是第几个、父级前缀是什么"
 * 两个因素决定。少一个字符，整棵树的对齐就歪了 —— 而树的价值全在对齐上。
 *
 * 纯逻辑：产出「带状态的行」，上色由组件做（与 `render_task_tree` 返回纯文本同一条口径）。
 */

export interface TaskNode {
  text: string;
  status: string;
  note: string;
  children: TaskNode[];
}

/** 与 `ace_layout.TaskNode.glyph()` 一致；认不出的状态回退 `·`。 */
export const TASK_GLYPHS: Record<string, string> = {
  pending: '·',
  in_progress: '▶',
  done: '✓',
  blocked: '✗',
};

export function taskGlyph(status: string): string {
  return TASK_GLYPHS[String(status)] ?? '·';
}

export interface TaskLine {
  /** 完整一行（含连接线与字形） */
  text: string;
  status: string;
  depth: number;
}

/**
 * 树 → 待渲染行。
 *
 * 空树（`null`）返回 `[]` —— 调用方不该画一棵空树：那只会让人以为「这里本来该有东西」。
 */
import { progressBar } from '../components/design-system/index.js';

export function flattenTaskTree(node: TaskNode | null, indent = 0): TaskLine[] {
  if (!node) return [];
  const out: TaskLine[] = [];

  const walk = (n: TaskNode, prefix: string, last: boolean, isRoot: boolean, depth: number): void => {
    const head = isRoot ? '' : `${prefix}${last ? '└─ ' : '├─ '}`;
    let line = `${head}${taskGlyph(n.status)} ${n.text}`;
    // 根节点的小进度条 —— 与 `ace_layout.render_task_tree` 同一份排版（逐行对拍）
    if (isRoot && n.children && n.children.length > 0) {
      const done = n.children.filter((c) => c.status === 'done').length;
      line += `  ${progressBar(done / n.children.length, 10)} ${done}/${n.children.length}`;
    }
    if (n.note) line += `  (${n.note})`;
    out.push({ text: line, status: n.status, depth });

    // 子级前缀：自己是最后一个 → 不画竖线（留空），否则画一根 `│`
    const childPrefix = isRoot ? '' : prefix + (last ? '   ' : '│  ');
    const kids = n.children ?? [];
    kids.forEach((c, i) => walk(c, childPrefix, i === kids.length - 1, false, depth + 1));
  };

  walk(node, ' '.repeat(Math.max(0, Math.trunc(indent))), true, true, 0);
  return out;
}

/** 树里有没有"还在进行中"的节点（状态行据此决定要不要提示"有任务在跑"）。 */
export function hasRunning(node: TaskNode | null): boolean {
  if (!node) return false;
  if (node.status === 'in_progress') return true;
  return (node.children ?? []).some(hasRunning);
}
