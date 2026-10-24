/**
 * **会话管理屏**的断言 —— 纯逻辑直接钉，排版用真帧量。
 *
 * 分工：分组/过滤/名字是纯函数（`sessions/layout.ts`），断言便宜且说得清；屏本身要
 * 证明"两栏都在、计数右对齐、过滤真的生效、Esc 先清筛选再关屏"，所以走
 * `mountTree()`（同 `pickers.test.tsx`，有 `useInput` 的组件只能这么测）。
 */

import { describe, expect, it } from 'vitest';

import { SessionManager } from '../src/components/sessions/SessionManager.js';
import {
  filterSessions,
  groupByWorkspace,
  pruneEmptyGroups,
  workspaceName,
  workspaceRoot,
} from '../src/components/sessions/layout.js';
import { stripAnsi } from '../src/render/text.js';
import { mountTree, waitFor, type MountedTree } from './mount.js';

const noColor = (): string | undefined => undefined;
const t = (k: string, params?: Record<string, string | number>): string =>
  params ? `${k}:${Object.values(params).join(',')}` : k;

const SESSIONS = [
  { path: 'G:\\AI_Project\\ace\\.ace_sessions\\a.jsonl', label: 'ace 第一条', when: '今天 10:00', turns: 12 },
  { path: 'G:\\AI_Project\\ace\\.ace_sessions\\b.jsonl', label: 'ace 第二条', when: '昨天 20:00', turns: 3 },
  { path: 'G:\\ai工作区\\dsh-TUI-main\\.ace_sessions\\c.jsonl', label: 'TUI 第一条', when: '10-10 09:00', turns: 7 },
];

function frame(m: MountedTree): string {
  return stripAnsi(m.lastFrame() ?? '');
}

async function open(rows: number): Promise<MountedTree> {
  // 宽度给足 120：左栏表头（`N 个工作区`）在 60 列下会被按栏宽截断 —— 那是**刻意的**
  // （不截就折行），但断言要看的是完整键名，所以这里用宽终端。
  const m = mountTree(
    <SessionManager sessions={SESSIONS} t={t} color={noColor} width={120} rows={rows}
                    onPick={() => undefined} onClose={() => undefined} />,
    { width: 120 },
  );
  await waitFor(() => m.frames.length > 0);
  return m;
}

describe('会话管理：分组与过滤（纯逻辑）', () => {
  it('工作区**穿过** `.ace_sessions` 取项目根（否则所有项目都叫 .ace_sessions）', () => {
    expect(workspaceRoot(SESSIONS[0]!.path)).toBe('G:\\AI_Project\\ace');
    expect(workspaceRoot(SESSIONS[2]!.path)).toBe('G:\\ai工作区\\dsh-TUI-main');
    expect(workspaceRoot('a/b/c.jsonl')).toBe('a/b');       // 不是会话目录约定：按原样
    expect(workspaceRoot('单段路径')).toBe('单段路径');
  });

  it('工作区名折叠家目录、取最后一段（否则左栏全是同一串前缀）', () => {
    expect(workspaceName('C:\\Users\\me\\proj\\ace', 'C:\\Users\\me')).toBe('ace');
    expect(workspaceName('/home/me/proj', '/home/me')).toBe('proj');
  });

  it('分组保持引擎顺序（最近用过的项目在最上面）并数对条数', () => {
    const groups = groupByWorkspace(SESSIONS);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 1]);
    expect(groups[0]!.rows[0]!.label).toBe('ace 第一条');
  });

  it('过滤是多词 AND、大小写不敏感、也认工作区名', () => {
    expect(filterSessions(SESSIONS, 'ACE 第二条').map((s) => s.label)).toEqual(['ace 第二条']);
    expect(filterSessions(SESSIONS, 'tui').map((s) => s.label)).toEqual(['TUI 第一条']);
    expect(filterSessions(SESSIONS, 'ace 不存在')).toEqual([]);
    expect(filterSessions(SESSIONS, '')).toHaveLength(3);
  });

  it('过滤后丢掉空组（左栏只列还有内容的项目）', () => {
    const groups = pruneEmptyGroups(groupByWorkspace(filterSessions(SESSIONS, 'tui')));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(1);
  });
});

describe('会话管理屏：真帧', () => {
  it('标题、两栏、各自的计数都画出来了', async () => {
    const m = await open(6);
    const out = frame(m);
    m.unmount();
    expect(out).toContain('sessions_manage_title');
    expect(out).toContain('sessions_manage_workspaces:2');   // 两个工作区
    expect(out).toContain('ace');                            // 左栏工作区名
    expect(out).toContain('ace 第一条');                      // 右栏（默认焦点在右）
    expect(out).toContain('sessions_turns:12');              // 右对齐的轮数
    expect(out).toContain('│');                              // 1 列分隔
  });

  it('输入即过滤：打 "tui" 之后只剩那个工作区与会话', async () => {
    const m = await open(6);
    m.stdin.write('tui');
    await waitFor(() => frame(m).includes('TUI 第一条'), 500);
    const out = frame(m);
    m.unmount();
    expect(out).toContain('TUI 第一条');
    expect(out).not.toContain('ace 第一条');
    expect(out).toContain('sessions_manage_workspaces:1');
  });

  it('Esc 先清筛选，第二次才关屏', async () => {
    let closed = 0;
    const m = mountTree(
      <SessionManager sessions={SESSIONS} t={t} color={noColor} width={120}
                      onPick={() => undefined} onClose={() => (closed += 1)} />,
      { width: 120 },
    );
    await waitFor(() => m.frames.length > 0);
    m.stdin.write('tui');
    await waitFor(() => frame(m).includes('TUI 第一条'), 500);
    m.stdin.write('\u001b');                                  // Esc ①：清筛选
    await waitFor(() => !frame(m).includes('TUI 第一条'), 500);
    expect(closed).toBe(0);
    m.stdin.write('\u001b');                                  // Esc ②：关屏
    await waitFor(() => closed > 0, 500);
    m.unmount();
    expect(closed).toBe(1);
  });

  it('空结果是"没有匹配的会话"，不是一片空白', async () => {
    const m = await open(6);
    m.stdin.write('zzz');
    await waitFor(() => frame(m).includes('sessions_manage_empty'), 500);
    const out = frame(m);
    m.unmount();
    expect(out).toContain('sessions_manage_empty');
  });

  it('窄终端（60 列）下表头按栏宽截断、**不折行** —— 行数与宽终端一致', async () => {
    const wide = await open(6);
    const wideLines = frame(wide).split('\n').length;
    wide.unmount();

    const m = mountTree(
      <SessionManager sessions={SESSIONS} t={t} color={noColor} width={60} rows={6}
                      onPick={() => undefined} onClose={() => undefined} />,
      { width: 60 },
    );
    await waitFor(() => m.frames.length > 0);
    const out = frame(m);
    m.unmount();
    // 表头被截断（没截就会折成两行，左栏第一行不再是表头）
    expect(out).not.toContain('sessions_manage_workspaces:2');
    expect(out.split('\n').length).toBe(wideLines);
  });
});
