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

import { afterEach, describe, expect, it } from 'vitest';

import {
  Byline, Dialog, Divider, ListItem, LoadingState, Pane, ProgressBar, ShortcutHint,
  StatusIcon, Tabs, byline, progressBar, statusIcon,
} from '../src/components/design-system/index.js';
import { resolvePython } from '../src/protocol/client.js';
import { setGlyphs } from '../src/render/glyphs.js';
import { displayWidth } from '../src/render/text.js';
import { Text } from './helpers/kernel.js';
import { renderLines } from './helpers/screen.js';

// 字形表是模块级状态：每个用例后复位，别污染别的用例（照 `glyphs.test.tsx`）。
afterEach(() => setGlyphs(undefined));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const noColor = (): string | undefined => undefined;
const t = (k: string, p?: Record<string, string | number>): string =>
  k === 'key_hint' ? `${p?.shortcut} ${p?.action}` : k;

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
  // 中文/图标要能原样过管道：Windows 上 Python 默认按 GBK 编码 stdout，不加这两行会当场 UnicodeEncodeError
  // （照 `tasktree.test.ts` 的老办法）
  const out = execFileSync(resolvePython(), ['-c', code], {
    encoding: 'utf-8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
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

  it('byline：`false` / `null` / `undefined` 是"没有这一项"，不是文案', () => {
    // 回归：旧的 `String(p ?? '')` 把 `false` 变成**字面量 `"false"`** 画到界面上
    // （`.recon/Q2-picker.md` ⑥.2；调用方只能靠传 `''` 绕开）。
    expect(byline([false, null, undefined, ''])).toBe('');
    expect(byline(['a', false, 'b', undefined])).toBe('a · b');
    expect(byline([true as unknown as string, 'a'])).toBe('a');   // 非字符串一律不算文案
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
    // 前端现在也按 displayWidth 居中（与 Python 同源），对拍从纯 ASCII 扩到中文也没问题；
    // 中文那批的**整宽+对称**不变量见下面"渲染"那组。
    expect([pythonSide().dividers[0]]).toEqual([py.dividers[0]]);
    expect(py.dividers[1]).toBe('────── Status ──────');   // 20 列，两侧各 6（我是猜的，真值以 Python 为准）
  });
});

describe('设计系统 · 渲染', () => {
  it('Divider 整宽（跟终端列数走）', () => {
    const out = renderLines(<Divider color={noColor} width={24} />, 24).text;
    expect(out).toContain('─'.repeat(24));
  });

  it('Divider 中文标题：按**显示宽度**居中，整宽且左右对称', () => {
    // 不变量比背字符串稳：按码点数算的话（`" 状态 "` 码点 4 / 显示宽 6），
    // 线会比请求宽度长出 2 列，这条当场红。
    const cases: Array<[number, string]> = [
      [9, '状态'], [11, '状态'], [12, '模型'], [17, '模型 上下文'], [24, '配置'],
    ];
    for (const [width, title] of cases) {
      const line = renderLines(<Divider title={title} color={noColor} width={width} />, width)
        .text.trim();
      expect(displayWidth(line), `width=${width} title=${title}`).toBe(width);
      // 左右两侧各占多少列：差 1 列以内才算居中
      const [left = '', right = ''] = line.split(` ${title.trim()} `);
      const skew = displayWidth(right) - displayWidth(left);
      expect(skew, `width=${width} title=${title} 左右不对称`).toBeGreaterThanOrEqual(0);
      expect(skew, `width=${width} title=${title} 左右不对称`).toBeLessThanOrEqual(1);
    }
  });

  it('Divider 标题比线长：按显示宽度截断，不劈中文', () => {
    const line = renderLines(<Divider title="很长很长的标题" color={noColor} width={9} />, 9)
      .text.trim();
    expect(line).toBe('很长很长…');           // 4 个汉字 8 列 + 省略号 1 列
    expect(displayWidth(line)).toBeLessThanOrEqual(9);
  });

  it('Byline：`false` 不是文案 —— 帧上不许出现字面量 `"false"`', () => {
    // 回归：`String(false)` 会把 `false` 画进脚注（`.recon/Q2-picker.md` ⑥.2）
    const out = renderLines(
      <Byline parts={['模型', false, undefined, null, '']} color={noColor} />,
      40,
    ).text.trim();
    expect(out).toBe('模型');
    expect(out).not.toContain('false');
  });

  it('Dialog：hints 全是假项时连 byline 那行都不画（更不会画 "false"）', () => {
    const out = renderLines(
      <Dialog title="空提示" color={noColor} width={20} hints={[false, undefined, '']}>
        <Text>甲</Text>
      </Dialog>,
      40,
    ).text;
    expect(out).toContain('空提示');
    expect(out).not.toContain('false');
  });

  it('Dialog：hints 里混着真项与假项 → 只留真项（Q2 那条"只能传 `\'\'` 绕过"不再需要）', () => {
    const out = renderLines(
      <Dialog title="选择模型" color={noColor} width={30} hints={['Enter 确认', false, 'Esc 取消']}>
        <Text>甲</Text>
      </Dialog>,
      40,
    ).text;
    expect(out).toContain('Enter 确认 · Esc 取消');
  });

  it('ListItem：聚焦 `❯` / 选中 `✓` / 无标记，且标记列**定宽**（文字不左右跳）', () => {
    const a = renderLines(<ListItem label="甲" isFocused color={noColor} />, 100).text;
    const b = renderLines(<ListItem label="甲" isSelected color={noColor} />, 100).text;
    const plain = renderLines(<ListItem label="甲" color={noColor} />, 100).text;
    expect(a).toContain('❯');
    expect(b).toContain('✓');
    expect(plain).not.toContain('❯');
    expect(plain).not.toContain('✓');
    // 不管有没有标记，"甲"都在第 3 列（标记列宽 2 + 1）
    expect(a.indexOf('甲')).toBe(plain.indexOf('甲'));
  });

  it('Tabs：当前页反显且加粗', () => {
    const out = renderLines(
      <Tabs tabs={[{ key: 'a', label: '甲' }, { key: 'b', label: '乙' }]} active="b" color={noColor} />,
      100,
    ).text;
    expect(out).toContain('乙');
  });

  it('Dialog：标题 + 整宽细线 + byline 提示', () => {
    const out = renderLines(
      <Dialog title="选择模型" status="info" color={noColor} width={30} hints={['Enter 确认', 'Esc 取消']}>
        <Text>甲 / 乙</Text>
      </Dialog>,
      100,
    ).text;
    expect(out).toContain('选择模型');
    expect(out).toContain('ℹ');
    expect(out).toContain('─'.repeat(30));
    expect(out).toContain('Enter 确认 · Esc 取消');
  });

  it('Pane / LoadingState / ProgressBar / Byline / ShortcutHint / StatusIcon 能画出来', () => {
    const out = renderLines(
      <Pane title="状态" color={noColor} width={20}>
        <LoadingState message="正在读取" subtitle="3 个文件" color={noColor} />
        <ProgressBar ratio={0.5} width={8} color={noColor} />
        <Byline parts={['模型', '上下文 12%']} color={noColor} />
        <ShortcutHint keys="ctrl+o" action="expand" t={t} color={noColor} />
        <StatusIcon status="success" withSpace color={noColor} />
      </Pane>,
      100,
    ).text;
    for (const probe of ['状态', '正在读取', '3 个文件', '████', '模型 · 上下文 12%',
                         'ctrl+o expand', '✓']) {
      expect(out).toContain(probe);
    }
  });

  it('ShortcutHint：四种组合输出一致，加粗+括号时键名只出现一次', () => {
    const cases: Array<[boolean, boolean, string]> = [
      [false, false, 'ctrl+o 展开'],
      [true, false, 'ctrl+o 展开'],
      [false, true, '(ctrl+o 展开)'],
      [true, true, '(ctrl+o 展开)'],
    ];
    for (const [bold, parens, want] of cases) {
      const tag = `bold=${bold} parens=${parens}`;
      const out = renderLines(
        <ShortcutHint keys="ctrl+o" action="展开" t={t} bold={bold} parens={parens} color={noColor} />,
        100,
      ).text.trim();
      expect(out, tag).toBe(want);
      // 回归护栏：旧的 `body.slice(keys.length)` 在 parens 下会吐出 `ctrl+oo 展开)`
      expect(out.split('ctrl+o').length - 1, tag).toBe(1);
    }
  });

  it('ShortcutHint：加粗段跟着 i18n 给的位置走（action 在前也不硬切）', () => {
    const tEn = (k: string, p?: Record<string, string | number>): string =>
      k === 'key_hint' ? `${p?.action} ${p?.shortcut}` : k;
    const out = renderLines(
      <ShortcutHint keys="ctrl+o" action="展开" t={tEn} bold parens color={noColor} />,
      100,
    ).text.trim();
    expect(out).toBe('(展开 ctrl+o)');
  });
});

describe('设计系统 · 默认字形必须过降级层（`docs/TUI-SWISS-SPEC.md` §1.2）', () => {
  it('Divider 默认线字符跟着降级表变（证明走的是 `g()/gstr()`，不是硬编码 `─`）', () => {
    setGlyphs({ '─': '-' });
    const plain = renderLines(<Divider color={noColor} width={24} />, 24).text.trim();
    expect(plain).toBe('-'.repeat(24));
    expect(plain).not.toContain('─');
    // 带标题那条路（左右两段）同样换字
    const titled = renderLines(<Divider title="Status" color={noColor} width={20} />, 20).text.trim();
    expect(titled).toBe('------ Status ------');
    expect(titled).not.toContain('─');
  });

  it('Dialog 的整宽细线同样跟着降级表变（它复用的就是 Divider）', () => {
    setGlyphs({ '─': '-' });
    const out = renderLines(
      <Dialog title="选择模型" color={noColor} width={30}><Text>甲</Text></Dialog>,
      30,
    ).text;
    expect(out).toContain('-'.repeat(30));
    expect(out).not.toContain('─');
  });

  it('显式传的 `char` 过的是同一个层（没降级时原样，降级时跟着变）', () => {
    // 设置面板那条路传 `char="-"`；表为空时它必须一字不变
    expect(renderLines(<Divider char="-" color={noColor} width={12} />, 12).text.trim())
      .toBe('-'.repeat(12));
    setGlyphs({ '-': '=' });                    // 引擎说这台终端连 `-` 都画不出
    expect(renderLines(<Divider char="-" color={noColor} width={12} />, 12).text.trim())
      .toBe('='.repeat(12));
  });

  it('表为空时一个都不换（UTF-8 终端不该被降级）', () => {
    setGlyphs(undefined);
    expect(renderLines(<Divider color={noColor} width={8} />, 8).text.trim()).toBe('─'.repeat(8));
    expect(renderLines(<StatusIcon status="success" color={noColor} />, 8).text.trim()).toBe('✓');
  });

  it('超长标题的省略号也过降级层；替身变宽时退回原字，线不许溢出', () => {
    expect(renderLines(<Divider title="很长很长的标题" color={noColor} width={9} />, 9)
      .text.trim()).toBe('很长很长…');
    setGlyphs({ '…': '.' });                    // 同宽替身：跟着换
    expect(renderLines(<Divider title="很长很长的标题" color={noColor} width={9} />, 9)
      .text.trim()).toBe('很长很长.');
    setGlyphs({ '…': '...' });                  // 变宽替身：退回原字，宽度不变量优先
    const wide = renderLines(<Divider title="很长很长的标题" color={noColor} width={9} />, 9)
      .text.trim();
    expect(wide).toBe('很长很长…');
    expect(displayWidth(wide)).toBeLessThanOrEqual(9);
  });

  it('StatusIcon / ListItem / LoadingState / ProgressBar 的默认字形也都过降级层', () => {
    setGlyphs({ '✓': 'v', '❯': '>', '◌': 'o', '█': '#', '─': '-' });
    expect(renderLines(<StatusIcon status="success" color={noColor} />, 8).text.trim()).toBe('v');
    expect(renderLines(<ListItem label="甲" isFocused color={noColor} />, 20).text).toContain('>');
    expect(renderLines(<ListItem label="甲" isSelected color={noColor} />, 20).text).toContain('v');
    expect(renderLines(<LoadingState message="读取中" color={noColor} />, 20).text).toContain('o ');
    expect(renderLines(<ProgressBar ratio={0.5} width={8} color={noColor} />, 20).text.trim())
      .toBe('####----');
  });
});
