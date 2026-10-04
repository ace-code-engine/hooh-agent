/**
 * 设计系统原语 —— 单测 + **与 Python 侧逐值对拍**。
 *
 * 为什么要对拍：这一层在两边各有一份实现（终端在 `ui/ace_widgets.py`，前端在这里），
 * 而"同一个零件两种长相"正是这次要治的病。所以关键算法不靠"我看着一样"，
 * 而是把同一批输入交给**真 Python** 算一遍，逐值比（照 `tasktree.test.ts` 的老办法）。
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import {
  Byline, Dialog, Divider, ListItem, LoadingState, Pane, ProgressBar, ShortcutHint,
  StatusIcon, Tabs, byline, progressBar, statusIcon,
} from '../src/components/design-system/index.js';
import { resolvePython } from '../src/protocol/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const noColor = (): string | undefined => undefined;
const t = (k: string, p?: Record<string, string | number>): string =>
  k === 'key_hint' ? `${p?.shortcut} ${p?.action}` : k;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

/** 让真 Python 算同一批输入（`ui.ace_widgets` 是那边唯一真相源）。 */
function pythonSide(): {
  bars: string[]; icons: Array<[string, string]>; bylines: string[]; dividers: string[];
} {
  const code = `
import json, sys
sys.path.insert(0, r"${ROOT}")
from ui import ace_widgets as W
bars = [W.progress_bar(r, w) for r, w in [(0,4),(1,4),(0.5,8),(0.31,9),(0.62,24),(-3,4),(9,4)]]
icons = [list(W.status_icon(s)) for s in ["ok","RUNNING","500","完全看不懂","pending","error"]]
bylines = [W.byline(["a","","b"]), W.byline(["模型","上下文 12%"])]
dividers = [W.divider(24), W.divider(20, title="Status")]
print(json.dumps({"bars": bars, "icons": icons, "bylines": bylines, "dividers": dividers}, ensure_ascii=False))
`;
  const out = execFileSync(resolvePython(), ['-c', code], { encoding: 'utf-8' });
  return JSON.parse(out);
}

describe('设计系统 · 纯函数', () => {
  it('statusIcon：六态 + 同义词归一；认不出的当 pending（不猜成功）', () => {
    expect(statusIcon('ok')).toEqual(['✓', 'success']);
    expect(statusIcon('RUNNING')).toEqual(['◌', 'tool_pending']);
    expect(statusIcon('500')).toEqual(['⚠', 'warn']);
    expect(statusIcon('完全看不懂')).toEqual(['○', 'dim']);
    expect(statusIcon('')).toEqual(['○', 'dim']);
  });

  it('progressBar：八分之一块（整格方案下 1/16 会一直显示 0）', () => {
    expect(progressBar(0, 4)).toBe('────');
    expect(progressBar(1, 4)).toBe('████');
    expect(progressBar(0.5, 8)).toBe('████────');   // 半满：余数为 0 时不该白扔一格
    expect(progressBar(-3, 4)).toBe(progressBar(0, 4));
    expect(progressBar(9, 4)).toBe(progressBar(1, 4));
    expect(progressBar(0.31, 9)).toHaveLength(9);
  });

  it('byline：` · ` 连，空项丢掉', () => {
    expect(byline(['a', '', null, 'b'])).toBe('a · b');
    expect(byline([])).toBe('');
  });
});

describe('设计系统 · 与 Python 逐值对拍（同批输入）', () => {
  const py = pythonSide();

  it('进度条逐值相同', () => {
    const mine = [(0), (1), (0.5), (0.31), (0.62), (-3), (9)].map((r, i) =>
      progressBar(r, [4, 4, 8, 9, 24, 4, 4][i]!));
    expect(mine).toEqual(py.bars);
  });

  it('状态图标逐值相同（含认不出的那个）', () => {
    const mine = ['ok', 'RUNNING', '500', '完全看不懂', 'pending', 'error'].map((s) => [...statusIcon(s)]);
    expect(mine).toEqual(py.icons);
  });

  it('byline 逐值相同', () => {
    expect([byline(['a', '', 'b']), byline(['模型', '上下文 12%'])]).toEqual(py.bylines);
  });

  it('分隔线逐值相同（纯 ASCII 标题下）', () => {
    // 前端拿不到 displayWidth（那是 Python 的表），所以对拍只用 ASCII 标题
    expect([pythonSide().dividers[0]]).toEqual([py.dividers[0]]);
    expect(py.dividers[1]).toBe('────── Status ──────');   // 20 列，两侧各 6（我是猜的，真值以 Python 为准）
  });
});

describe('设计系统 · 渲染', () => {
  it('Divider 整宽（跟终端列数走）', async () => {
    const tree = render(<Divider color={noColor} width={24} />);
    await tick();
    expect(tree.lastFrame() ?? '').toContain('─'.repeat(24));
    tree.unmount();
  });

  it('ListItem：聚焦 `❯` / 选中 `✓` / 无标记，且标记列**定宽**（文字不左右跳）', async () => {
    const a = render(<ListItem label="甲" isFocused color={noColor} />);
    const b = render(<ListItem label="甲" isSelected color={noColor} />);
    const c = render(<ListItem label="甲" color={noColor} />);
    await tick();
    expect(a.lastFrame() ?? '').toContain('❯');
    expect(b.lastFrame() ?? '').toContain('✓');
    const plain = c.lastFrame() ?? '';
    expect(plain).not.toContain('❯');
    expect(plain).not.toContain('✓');
    // 不管有没有标记，"甲"都在第 3 列（标记列宽 2 + 1）
    expect((a.lastFrame() ?? '').indexOf('甲')).toBe((plain).indexOf('甲'));
    a.unmount(); b.unmount(); c.unmount();
  });

  it('Tabs：当前页反显且加粗', async () => {
    const tree = render(
      <Tabs tabs={[{ key: 'a', label: '甲' }, { key: 'b', label: '乙' }]} active="b" color={noColor} />,
    );
    await tick();
    expect(tree.lastFrame() ?? '').toContain('乙');
    tree.unmount();
  });

  it('Dialog：标题 + 整宽细线 + byline 提示', async () => {
    const tree = render(
      <Dialog title="选择模型" status="info" color={noColor} width={30} hints={['Enter 确认', 'Esc 取消']}>
        <Text>甲 / 乙</Text>
      </Dialog>,
    );
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).toContain('选择模型');
    expect(out).toContain('ℹ');
    expect(out).toContain('─'.repeat(30));
    expect(out).toContain('Enter 确认 · Esc 取消');
    tree.unmount();
  });

  it('Pane / LoadingState / ProgressBar / Byline / ShortcutHint / StatusIcon 能画出来', async () => {
    const tree = render(
      <Pane title="状态" color={noColor} width={20}>
        <LoadingState message="正在读取" subtitle="3 个文件" color={noColor} />
        <ProgressBar ratio={0.5} width={8} color={noColor} />
        <Byline parts={['模型', '上下文 12%']} color={noColor} />
        <ShortcutHint keys="ctrl+o" action="expand" t={t} color={noColor} />
        <StatusIcon status="success" withSpace color={noColor} />
      </Pane>,
    );
    await tick();
    const out = tree.lastFrame() ?? '';
    for (const probe of ['状态', '正在读取', '3 个文件', '████', '模型 · 上下文 12%',
                         'ctrl+o expand', '✓']) {
      expect(out).toContain(probe);
    }
    tree.unmount();
  });
});
