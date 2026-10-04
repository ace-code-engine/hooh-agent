/**
 * 会话树屏的渲染与按键测试。
 *
 * 为什么单开一个文件：`session-tree/` 是新屏，没有任何现成套件覆盖它；
 * 而且它最容易错的两块（**树几何**与**"没数据时说什么"**）都不是类型系统能拦住的 ——
 * 类型全对、画出来是面条或一片空白，这类错只能靠帧断言抓。
 *
 * ## 帧怎么取
 *
 * 一律走 `mountTree()`（内核 `renderSync` + 假 stdio）：组件里有 `useInput`，
 * 而 `renderLines()` 的 `renderToScreen` **不提供任何 React context** ——
 * `useStdin()` 会当场抛。取到的帧带 ANSI，用 `stripAnsi()` 剥掉再看文字；
 * 反显那一条断言**故意看 ANSI**（选中只有反显这一种表达，剥掉就测不到了）。
 *
 * ## 夹具为什么长这样
 *
 * `DATA` 三岔口：`12 → 18 → {24, 31}`，活跃头在 `24`（**不是**最后一条 31）。
 * 活跃头故意选中间那个：选最后一条的话，"光标起手落在活跃头"与"落在第一行"
 * 有一半的用例会碰巧同时成立。
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { SessionTree, type SessionTreeProps } from '../src/components/session-tree/index.js';
import { displayWidth, stripAnsi } from '../src/render/text.js';
import { mountTree } from './mount.js';

/** 只列本组件用到的键；缺的键回退成键名（一眼看出漏了哪条文案）。 */
const DICT: Record<string, string> = {
  stree_title: '会话分支',
  stree_tips: '末梢 {n} 条',
  stree_kind_user: '你',
  stree_kind_assistant: '助手',
  stree_tip: '末梢',
  stree_empty: '  暂无分支数据（引擎没有返回会话树）。',
  stree_loading: '  正在读取会话树…',
  stree_lineage: '跨会话来源：{id}',
  stree_none: '暂无',
  stree_hint: '  ↑↓ 移动 · Enter 切到该分支 · Esc 退出',
  tree_active: ' ← 活跃',
  tree_single: '  这个会话只有一条分支。',
  sessions_turns: '{n} 轮',
};

const t = (key: string, params?: Record<string, string | number>): string => {
  const raw = DICT[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
};
const noColor = (): string | undefined => undefined;

const DATA = {
  session_id: '20261004-1930',
  nodes: [
    { seq: 12, kind: 'user/message', parent: 0, tip: false, turn: 1, preview: '先看缓存那层' },
    { seq: 18, kind: 'assistant/message', parent: 12, tip: false, turn: 1, preview: '看完了，问题在 TTL' },
    { seq: 24, kind: 'user/message', parent: 18, tip: true, turn: 2, preview: '那改成滑动窗口' },
    { seq: 31, kind: 'assistant/message', parent: 18, tip: true, turn: 2, preview: '换个思路先加指标' },
  ],
  active_head: 24,
  tips: [24, 31],
  single: false,
  parent_session: '',
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

interface Mounted {
  readonly stdin: { write: (s: string) => void };
  rerender: (tree: ReactElement) => void;
  plain: () => string;
  /** 原始帧（带 ANSI）—— 反显/底色那两条纪律只能在这里断言。 */
  raw: () => string;
  /**
   * 焦点行（`❯ ` 那一行）。
   *
   * 为什么靠标记而不是靠反显去认：测试进程的 stdout 不是 TTY，chalk 在 import 时就定成
   * 无色级（`preview.test.ts` 已记录这条环境事实），**帧里一条样式码都没有** ——
   * 反显在这套台上不可观测。`❯` 是帧里真实存在的焦点表达，拿它断言才不是自欺。
   */
  focused: () => string;
  lines: () => string[];
}

/** 焦点标记（与组件里的 `MARKER` 同字）。 */
const FOCUSED = '❯';

/**
 * 数宽度前把**非 SGR** 的控制序列也剥掉。
 *
 * `stripAnsi()` 只认 `ESC[...m`（与 Python 的 `ace_text._ANSI_SGR` 同口径），
 * 而内核每帧还会写同步更新的一对（`ESC[?2026h` / `ESC[?2026l`）—— 收尾那个会跟着
 * 最后一帧一起进来，被当成 8 个可见字符，宽度断言当场假红。
 */
const CSI_ANY = /\u001b\[[0-9:;<=>?]*[ -/]*[@-~]/g;
const visible = (line: string): string => line.replace(CSI_ANY, '');

async function mount(data: unknown, extra: Partial<SessionTreeProps> = {}, width = 100): Promise<Mounted> {
  const h = mountTree(<SessionTree data={data} t={t} color={noColor} width={width} {...extra} />, { width });
  await tick();
  const plain = (): string => stripAnsi(h.lastFrame() ?? '');
  return {
    stdin: h.stdin,
    rerender: (tree) => h.rerender(tree),
    plain,
    raw: () => h.lastFrame() ?? '',
    focused: () => plain().split('\n').find((l) => l.includes(FOCUSED)) ?? '',
    lines: () => plain().split('\n'),
  };
}

describe('会话树 · 树形几何', () => {
  it('三岔口按缩进 + 连接符画出来（`└─` 收尾、`├─` 还有兄弟）', async () => {
    const m = await mount(DATA);
    // 18 是 12 的唯一子节点 ⇒ 收尾；24/31 在同一层 ⇒ 前者 `├─`、后者 `└─`
    expect(m.plain()).toContain('└─ 18');
    expect(m.plain()).toContain('├─ 24');
    expect(m.plain()).toContain('└─ 31');
    // 24 的竖线接在 18 那一层上（18 还有兄弟？没有 —— 18 是独子，所以这里不该有 `│`）
    expect(m.plain()).not.toContain('│');
  });

  it('深一层：父层还有兄弟时，子节点前面接着画竖线', async () => {
    const m = await mount({
      nodes: [
        { seq: 1, kind: 'user/message', parent: 0, tip: false, turn: 1, preview: '根' },
        { seq: 2, kind: 'user/message', parent: 1, tip: false, turn: 1, preview: '长子' },
        { seq: 3, kind: 'assistant/message', parent: 1, tip: true, turn: 2, preview: '次子' },
        { seq: 4, kind: 'assistant/message', parent: 2, tip: true, turn: 2, preview: '长孙' },
      ],
      active_head: 3,
      tips: [3, 4],
      single: false,
      parent_session: '',
    });
    const grandchild = m.lines().find((l) => l.includes('长孙'));
    expect(grandchild).toContain('│'); // 它的父（2）还有兄弟 3 ⇒ 竖线要接下去
    expect(grandchild).toContain('└─');
  });

  it('多个根不接悬空竖线：根画在第 0 列，没有连接符可接', async () => {
    const m = await mount({
      nodes: [
        { seq: 1, kind: 'user/message', parent: 0, tip: false, turn: 1, preview: '根一' },
        { seq: 2, kind: 'user/message', parent: 0, tip: true, turn: 1, preview: '根二' },
        { seq: 3, kind: 'assistant/message', parent: 1, tip: true, turn: 2, preview: '根一的子' },
      ],
      active_head: 3,
      tips: [2, 3],
      single: false,
      parent_session: '',
    });
    expect(m.plain()).not.toContain('│');
    expect(m.lines().find((l) => l.includes('根一的子'))).toContain('└─');
  });

  it('当前分支头**只有一行**带「活跃」标记，且落在 active_head 上', async () => {
    const m = await mount(DATA);
    const marked = m.lines().filter((l) => l.includes('← 活跃'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('24');
    expect(marked[0]).toContain('那改成滑动窗口');
  });
});

describe('会话树 · 信息层级', () => {
  it('每行是「身份 · 谁说的 · 轮次 · 摘要」四段', async () => {
    const m = await mount(DATA);
    const row = m.lines().find((l) => l.includes('看完了，问题在 TTL'));
    expect(row).toBeDefined();
    expect(row).toContain('18');
    expect(row).toContain('助手');
    expect(row).toContain('1 轮');
  });

  it('认不出的 kind 不给猜的标签（那一列空着，而不是写个 "assistant"）', async () => {
    const m = await mount({
      nodes: [{ seq: 7, kind: 'notice/thing', parent: 0, tip: true, turn: 1, preview: '未知类' }],
      active_head: 7,
      tips: [7],
      single: false,
      parent_session: '',
    });
    const row = m.lines().find((l) => l.includes('未知类'));
    expect(row).toContain('7');
    expect(row).not.toContain('notice');
    expect(row).not.toContain('thing');
  });

  it('宽度纪律：窄终端下每一行的显示宽度都不超列宽（CJK 按 2 列算）', async () => {
    const m = await mount(DATA, {}, 41);
    // 断言「超宽的行集合为空」：失败时 vitest 会把那些行原样打出来，一眼定位
    expect(m.lines().map(visible).filter((l) => displayWidth(l) > 41)).toEqual([]);
  });

  it('摘要放不下就按显示宽度截断（不折行、不把汉字劈一半）', async () => {
    const m = await mount(
      {
        nodes: [{ seq: 1, kind: 'user/message', parent: 0, tip: true, turn: 1, preview: '这一条摘要很长'.repeat(8) }],
        active_head: 1,
        tips: [1],
        single: false,
        parent_session: '',
      },
      {},
      60,
    );
    expect(m.plain()).toContain('…');
    for (const line of m.lines()) expect(displayWidth(visible(line))).toBeLessThanOrEqual(60);
  });

  it('顶栏把末梢条数钉在左、位置读数钉在右', async () => {
    const m = await mount(DATA);
    const head = m.lines().find((l) => l.includes('末梢 2 条'));
    expect(head).toBeDefined();
    expect(head?.trimEnd().endsWith('3/4')).toBe(true); // 光标起手在活跃头（第 3 行）
  });
});

describe('会话树 · 空态与缺数据防御', () => {
  it('没有任何数据 → 明确的「暂无」，不是空白', async () => {
    const m = await mount(null);
    expect(m.plain()).toContain('暂无分支数据');
    expect(m.plain()).toContain('会话分支'); // 标题还在，屏没崩
  });

  it('正在取数据与"确实是空的"分开说（不许把等待说成没有）', async () => {
    const m = await mount(null, { loading: true });
    expect(m.plain()).toContain('正在读取会话树');
    expect(m.plain()).not.toContain('暂无分支数据');
  });

  it('缺 tips / active_head / single / parent_session 也能画（末梢标记从节点自己推）', async () => {
    const m = await mount({
      nodes: [
        { seq: 5, kind: 'user/message', parent: 0, tip: false, turn: 1, preview: '根' },
        { seq: 9, kind: 'assistant/message', parent: 5, tip: true, turn: 2, preview: '末' },
      ],
    });
    expect(m.plain()).toContain('根');
    expect(m.plain()).toContain('末');
    expect(m.plain()).toContain('末梢 1 条'); // tips 从 tip 标记推出来
  });

  it('无分支数据（single）→ 照画那条链，并明说只有一条分支', async () => {
    const m = await mount({
      nodes: [{ seq: 3, kind: 'user/message', parent: 0, tip: true, turn: 1, preview: '唯一一条' }],
      active_head: 3,
      tips: [3],
      single: true,
      parent_session: '',
    });
    expect(m.plain()).toContain('唯一一条');
    expect(m.plain()).toContain('这个会话只有一条分支');
  });

  it('跨会话来源无生产者 → 如实标「暂无」，不拿同文件分支冒充血缘', async () => {
    const m = await mount(DATA);
    expect(m.plain()).toContain('跨会话来源：暂无');

    const withParent = await mount({ ...DATA, parent_session: '20261001-0900' });
    expect(withParent.plain()).toContain('跨会话来源：20261001-0900');
  });

  it('坏数据（parent 成环 / 指向不存在的 seq）既不死循环也不丢行', async () => {
    const m = await mount({
      nodes: [
        { seq: 4, kind: 'user/message', parent: 6, tip: false, turn: 1, preview: '环A' },
        { seq: 6, kind: 'assistant/message', parent: 4, tip: true, turn: 1, preview: '环B' },
        { seq: 8, kind: 'user/message', parent: 999, tip: true, turn: 2, preview: '悬空' },
      ],
      active_head: 6,
      tips: [6, 8],
      single: false,
      parent_session: '',
    });
    for (const name of ['环A', '环B', '悬空']) {
      expect(m.lines().filter((l) => l.includes(name))).toHaveLength(1);
    }
  });
});

describe('会话树 · 按键 → 帧', () => {
  it('起手光标落在**活跃头**上（不是第一行、也不是最后一行）', async () => {
    const m = await mount(DATA);
    expect(m.focused()).toContain('24');
    expect(m.focused()).toContain('那改成滑动窗口');
  });

  it('帧里**只有一个**焦点标记（光标是唯一的那一个）', async () => {
    const m = await mount(DATA);
    const hits = m.lines().filter((l) => l.includes(FOCUSED));
    expect(hits).toHaveLength(1);
  });

  it('↓ 走到下一行、↑ 走回上一行（焦点标记跟着动）', async () => {
    const m = await mount(DATA);
    m.stdin.write('\u001b[B'); // ↓
    await tick();
    expect(m.focused()).toContain('31');
    expect(m.focused()).toContain('换个思路先加指标');

    m.stdin.write('\u001b[A'); // ↑
    await tick();
    expect(m.focused()).toContain('24');
  });

  it('到顶不循环：连按 ↑ 仍停在第一行', async () => {
    const m = await mount(DATA);
    for (let i = 0; i < 5; i++) {
      m.stdin.write('\u001b[A');
      await tick();
    }
    expect(m.focused()).toContain('12');
    expect(m.focused()).toContain('先看缓存那层');
  });

  it('Enter 落在**末梢** → 发出 `/tree <编号>`（编号即 tips 顺序，非行号）', async () => {
    const onSelect = vi.fn();
    const m = await mount(DATA, { onSelect });
    m.stdin.write('\r');
    await tick();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[1]).toBe('/tree 1'); // 24 = tips[0]
  });

  it('Enter 落在**中间节点** → 发出 `/tree @<轮次>`（从那条链中间长新分支的入口）', async () => {
    const onSelect = vi.fn();
    const m = await mount(DATA, { onSelect });
    m.stdin.write('\u001b[A'); // 24 → 18
    await tick();
    m.stdin.write('\r');
    await tick();
    expect(onSelect.mock.calls[0]?.[1]).toBe('/tree @1');
  });

  it('既不是末梢、也没有轮次 → **不发命令**（盲发一条切不动分支的命令只会骗人）', async () => {
    const onSelect = vi.fn();
    const m = await mount({ nodes: [{ seq: 2, kind: 'user/message', parent: 0, tip: false, preview: '没轮次' }] }, { onSelect });
    m.stdin.write('\r');
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Esc → 通知调用方退出', async () => {
    const onClose = vi.fn();
    const m = await mount(DATA, { onClose });
    m.stdin.write('\u001b');
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('空数据时按键不崩、也不误发命令', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const m = await mount(null, { onSelect, onClose });
    m.stdin.write('\u001b[B');
    await tick();
    m.stdin.write('\r');
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
    expect(m.plain()).toContain('暂无分支数据');
  });

  it('节点多时窗口黏边滚动，焦点始终在窗口里', async () => {
    const nodes = Array.from({ length: 13 }, (_, i) => ({
      seq: i + 1,
      kind: i % 2 === 0 ? 'user/message' : 'assistant/message',
      parent: i === 0 ? 0 : i,
      tip: i === 12,
      turn: i + 1,
      preview: `P${String(i + 1).padStart(2, '0')}`,
    }));
    const m = await mount({ nodes, active_head: 13, tips: [13], single: false, parent_session: '' }, { height: 4 });
    expect(m.plain()).toContain('P13'); // 活跃头在最下面 ⇒ 窗口跟着滚到底
    expect(m.plain()).not.toContain('P01');
    expect(m.lines().filter((l) => l.includes('P')).length).toBeLessThanOrEqual(4);
  });

  it('选中行**不铺背景色**（帧里一条背景码都没有；规范 §1 第 5 条）', async () => {
    const m = await mount(DATA);
    expect(m.raw()).not.toMatch(/\u001b\[4[0-7]m/);
    // 本进程 non-TTY ⇒ chalk 无色级，帧里本来就只有内核自己的复位码。
    // 反显（选中手段）因此**在这套台上不可观测**，只能靠人眼/真机确认 —— 别拿它冒充断言。
    expect(m.plain()).toContain('会话分支');
  });

  it('品牌纪律：帧里不出现上游品牌/宿主名', async () => {
    const m = await mount(DATA);
    const text = m.plain().toLowerCase();
    expect(text).not.toContain('dsh');
    expect(text).not.toContain('deepseek');
  });
});
