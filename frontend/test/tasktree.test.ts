/**
 * 任务树测试 —— 与 `ui/ace_layout` **逐行比对**。
 *
 * 为什么必须逐行比：树的价值全在**对齐**上。少一个空格、竖线画错一层，
 * 整棵树就读不出来了 —— 而这种错在单看一行时完全看不出来。
 * 所以这里把同一棵树交给真 Python 渲染一遍，再逐行比。
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TASK_GLYPHS, flattenTaskTree, hasRunning, taskGlyph, type TaskNode } from '../src/render/tasktree.js';
import { resolvePython } from '../src/protocol/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = resolvePython();

/** 调真 Python 渲染同一棵树，拿回逐行结果。失败返回 null（环境没 Python 就跳过）。 */
function pythonRender(): string[] | null {
  const script = [
    'import sys, json',
    'from ui import ace_layout as L',
    // 形状与测试里的 TS 树完全一致：根 in_progress，两个子节点（done / blocked 带 note）
    'tree = L.TaskNode("目标 [R1/3] 把前端做完", "in_progress", [',
    '    L.TaskNode("#1 补全菜单", "done"),',
    '    L.TaskNode("#2 任务树", "blocked", note="等接口"),',
    '])',
    'print(json.dumps(L.render_task_tree(tree), ensure_ascii=False))',
  ].join('\n');
  try {
    const out = execFileSync(PY, ['-c', script], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      timeout: 60_000,
    });
    return JSON.parse(out.trim()) as string[];
  } catch {
    return null;
  }
}

const TREE: TaskNode = {
  text: '目标 [R1/3] 把前端做完',
  status: 'in_progress',
  note: '',
  children: [
    { text: '#1 补全菜单', status: 'done', note: '', children: [] },
    { text: '#2 任务树', status: 'blocked', note: '等接口', children: [] },
  ],
};

describe('字形与 ui/ace_layout 一致', () => {
  it('四种状态的字形逐条相同', () => {
    expect(taskGlyph('pending')).toBe('·');
    expect(taskGlyph('in_progress')).toBe('▶');
    expect(taskGlyph('done')).toBe('✓');
    expect(taskGlyph('blocked')).toBe('✗');
  });

  it('认不出的状态回退 `·`（不是抛，也不是空）', () => {
    expect(taskGlyph('不存在的状态')).toBe('·');
    expect(taskGlyph('')).toBe('·');
  });

  it('字形都是单宽、无 emoji（旧终端里会画成方框）', () => {
    for (const [status, g] of Object.entries(TASK_GLYPHS)) {
      expect([...g].length, status).toBe(1);
      expect(g.codePointAt(0)!, status).toBeLessThan(0x1f000);
    }
  });
});

describe('渲染与 Python 逐行一致', () => {
  const py = pythonRender();

  it.skipIf(py === null)('**同一棵树渲染出的每一行都相同**', () => {
    expect(py, '没拿到 Python 的渲染结果').not.toBeNull();
    const mine = flattenTaskTree(TREE).map((l) => l.text);
    expect(mine).toEqual(py);
  });

  it('根节点不带连接线（但带小进度条），子节点带 `├─` / `└─`', () => {
    const lines = flattenTaskTree(TREE).map((l) => l.text);
    // 根行 = `▶ 根文本  <进度条> 已完成/总数`（排版与 Python 侧逐行对拍，见上一组用例）
    expect(lines[0]).toContain('▶ 目标 [R1/3] 把前端做完');
    expect(lines[0]).toContain('1/2');
    expect(lines[0]).not.toContain('├─');
    expect(lines[1]).toContain('├─ ✓ #1 补全菜单');
    expect(lines[2]).toContain('└─ ✗ #2 任务树');
  });

  it('最后一项用 `└─`，其余用 `├─`', () => {
    const lines = flattenTaskTree(TREE).map((l) => l.text);
    expect(lines[1]).toContain('├─');
    expect(lines[2]).toContain('└─');
  });

  it('note 跟在行尾的括号里', () => {
    expect(flattenTaskTree(TREE).map((l) => l.text)[2]).toContain('(等接口)');
  });

  it('每行带上状态（组件据此上色，不必再解一遍文本）', () => {
    expect(flattenTaskTree(TREE).map((l) => l.status)).toEqual([
      'in_progress',
      'done',
      'blocked',
    ]);
  });
});

describe('深层嵌套的对齐', () => {
  const deep: TaskNode = {
    text: '根',
    status: 'in_progress',
    note: '',
    children: [
      {
        text: '甲',
        status: 'pending',
        note: '',
        children: [
          { text: '甲-1', status: 'done', note: '', children: [] },
          { text: '甲-2', status: 'done', note: '', children: [] },
        ],
      },
      { text: '乙', status: 'pending', note: '', children: [] },
    ],
  };

  it('非最后一项的子级前缀保留竖线（`│  `），最后一项不带', () => {
    const lines = flattenTaskTree(deep).map((l) => l.text);
    // 甲不是最后一项 → 它**下面**的子孙行前缀里有竖线（把甲的子树连到根上）
    expect(lines[2]).toContain('│');
    expect(lines[2]).toContain('甲-1');
    expect(lines[3]).toContain('│');
    // 乙是根的最后一项 → 它自己那行不带竖线（根的子级本来就没有前缀）
    expect(lines[4]).toContain('乙');
    expect(lines[4]).not.toContain('│');
    expect(lines[4]!.startsWith('└─')).toBe(true);
  });

  it('depth 逐层递增', () => {
    expect(flattenTaskTree(deep).map((l) => l.depth)).toEqual([0, 1, 2, 2, 1]);
  });
});

describe('边界', () => {
  it('空树返回空列表（**不画空树** —— 那会让人以为这里本来该有东西）', () => {
    expect(flattenTaskTree(null)).toEqual([]);
  });

  it('只有根节点时就是一行', () => {
    expect(flattenTaskTree({ text: '光杆', status: 'done', note: '', children: [] })).toHaveLength(1);
  });

  it('hasRunning 能看穿嵌套', () => {
    expect(hasRunning(TREE)).toBe(true);
    expect(hasRunning({ text: 'x', status: 'done', note: '', children: [] })).toBe(false);
    expect(hasRunning(null)).toBe(false);
    expect(
      hasRunning({
        text: 'x',
        status: 'done',
        note: '',
        children: [{ text: 'y', status: 'in_progress', note: '', children: [] }],
      }),
    ).toBe(true);
  });
});
