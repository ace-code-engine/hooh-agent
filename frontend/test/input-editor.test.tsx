/**
 * `Input` 的**编辑器交互**测试：Ctrl+R 历史搜索 + 大粘贴折叠（P4）。
 *
 * 为什么单开一个文件而不是并进 `input-queue.test.tsx`：那个文件钉的是"忙时排队"
 * 一条语义（它自己的头注里写明了），把两个新交互塞进去会让它同时背三件事。
 * 本文件与它共用 `./mount.js` 的 `mountTree()`。
 *
 * ## 怎么驱按键
 *
 * 都是**真字节**，不是直接调函数：Ctrl+R 是 0x12；粘贴走 bracketed paste 协议
 * （`\x1b[200~ … \x1b[201~`）—— 内核据此把它标成 `key.isPasted`（这正是折叠的触发条件，
 * 见 `vendor/dsh-ink/…/parse-keypress.js:1324`）。断言看的是**帧内容**，不是内部状态。
 *
 * ## 历史为什么要靠环境变量隔离
 *
 * Ctrl+R 的历史来源是"本会话提交过的行 + `~/.ace_history`"（后者是 ace 既有的跨会话
 * 历史，Python 侧 `_history_entries` 同一份）。本机真有一份的话，断言会被它的内容搅乱 ——
 * 所以整个文件里 `ACE_NO_HISTORY=1`（这正是 ace 自己的开关，口径与 Python 一致）。
 * 读文件那条路另用纯函数 `parseHistoryLines` 直接断言。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  filterHistory,
  foldLinesFor,
  Input,
  isBigText,
  parseHistoryLines,
} from '../src/components/Input.js';
import { mountTree, waitFor } from './mount.js';

const t = (k: string, params?: Record<string, string | number>): string =>
  params ? `${k}(${Object.values(params).join(',')})` : k;
const noColor = (): string | undefined => undefined;
const CTRL_R = '\x12';
const LEFT = '\x1b[D';
const DOWN = '\x1b[B';

/** 等两拍：Ink 的 setState + 重渲染是异步的，写一次键后要让它落下来。 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

interface Mounted {
  lastFrame: () => string | undefined;
  stdin: { write: (s: string) => void };
  /** 提交出去的行（按序）—— "回车是回填还是发送"靠它分辨。 */
  sent: string[];
}

function mount(): Mounted {
  const sent: string[] = [];
  const props = {
    t,
    color: noColor,
    onSubmit: (line: string) => {
      sent.push(line);
      return true;
    },
    width: 80,
    vim: false,
  };
  const r = mountTree(<Input {...props} busy={false} />);
  return { lastFrame: r.lastFrame, stdin: r.stdin, sent };
}

/** 起手要等首帧：`useInput` 在 effect 里订阅，订阅前写的键会被丢掉。 */
async function ready(): Promise<Mounted> {
  const m = mount();
  await tick();
  return m;
}

/** 打一行字并回车（进"本会话历史"）。 */
async function submitLine(m: Mounted, line: string): Promise<void> {
  m.stdin.write(line);
  await tick();
  m.stdin.write('\r');
  await tick();
}

/** 按 bracketed paste 协议粘一段（内核会把整块标成 `isPasted`）。 */
async function paste(m: Mounted, payload: string): Promise<void> {
  m.stdin.write('\x1b[200~' + payload + '\x1b[201~');
  await waitFor(() => m.lastFrame()?.includes('paste_folded') === true);
  await tick();
}

beforeAll(() => {
  process.env.ACE_NO_HISTORY = '1';
});
afterAll(() => {
  delete process.env.ACE_NO_HISTORY;
});

describe('Ctrl+R 历史搜索', () => {
  it('打开：查询行 + 命中（最近的在上）+ 提示行都在帧里', async () => {
    const m = await ready();
    await submitLine(m, '第一条输入');
    await submitLine(m, '第二条输入');

    m.stdin.write(CTRL_R);
    await tick();

    const f = m.lastFrame() ?? '';
    expect(f).toContain('key_search'); // 查询行
    expect(f).toContain('search_hint'); // 底部提示（"Enter 采用 · Esc 取消"）
    expect(f).toContain('▶ 第二条输入'); // 默认选中最近那条
    expect(f).toContain('  第一条输入');
  });

  it('增量过滤：继续打字只留命中的，没有命中时有话直说', async () => {
    const m = await ready();
    await submitLine(m, '甲方案');
    await submitLine(m, '乙方案');

    m.stdin.write(CTRL_R);
    await tick();
    m.stdin.write('甲');
    await tick();
    let f = m.lastFrame() ?? '';
    expect(f).toContain('甲方案');
    expect(f).not.toContain('乙方案');

    m.stdin.write('zzz');
    await tick();
    f = m.lastFrame() ?? '';
    expect(f).toContain('history_no_match(甲zzz)'); // 没命中就说没命中，不装样子
  });

  it('↑↓ 选，再按 Ctrl+R 走下一条，到底不循环', async () => {
    const m = await ready();
    await submitLine(m, 'AAA');
    await submitLine(m, 'BBB');

    m.stdin.write(CTRL_R);
    await tick();
    m.stdin.write(DOWN);
    await tick();
    expect(m.lastFrame() ?? '').toContain('▶ AAA'); // 最新的在上，↓ 往下走

    m.stdin.write(DOWN); // 已经在最后一条 → 停住（不绕回 BBB）
    await tick();
    expect(m.lastFrame() ?? '').toContain('▶ AAA');

    m.stdin.write(CTRL_R); // 再按 Ctrl+R 也是"下一条"
    await tick();
    expect(m.lastFrame() ?? '').toContain('▶ AAA');
  });

  it('回车 = 回填**不发送**（再按一次回车才发）', async () => {
    const m = await ready();
    await submitLine(m, '刚才那句话');

    m.stdin.write(CTRL_R);
    await tick();
    m.stdin.write('\r');
    await tick();

    let f = m.lastFrame() ?? '';
    expect(m.sent).toEqual(['刚才那句话']); // 只有 submitLine 那一次
    expect(f).not.toContain('search_hint'); // 搜索已关
    expect(f).toContain('刚才那句话'); // 已经躺在输入行里

    m.stdin.write('\r');
    await tick();
    expect(m.sent).toEqual(['刚才那句话', '刚才那句话']); // 这一次才是发送
  });

  it('Esc 只关搜索：草稿原样留着（不会顺手清空输入）', async () => {
    const m = await ready();
    await submitLine(m, '历史里的东西');

    m.stdin.write('半截草稿');
    await tick();
    m.stdin.write(CTRL_R);
    await tick();
    expect(m.lastFrame() ?? '').toContain('search_hint');

    m.stdin.write('\x1b'); // Esc：裸 ESC 由内核的 50ms flush 定时器放行，不能只等一个 tick
    await waitFor(() => m.lastFrame()?.includes('search_hint') === false);
    await tick();
    const f = m.lastFrame() ?? '';
    expect(f).not.toContain('search_hint');
    expect(f).toContain('半截草稿');
    expect(m.sent).toEqual(['历史里的东西']);
  });

  it('历史为空时不弹（没什么可选的就别装样子）', async () => {
    const m = await ready();
    m.stdin.write(CTRL_R);
    await tick();
    expect(m.lastFrame() ?? '').not.toContain('search_hint');
  });
});

describe('大粘贴折叠', () => {
  it('8 行粘贴 → 折成一行提示，屏幕上不再铺原文', async () => {
    const m = await ready();
    const payload = Array.from({ length: 8 }, (_, i) => `第${i + 1}行`).join('\n');

    await paste(m, payload);

    const f = m.lastFrame() ?? '';
    expect(f).toContain('paste_folded(8)');
    expect(f).not.toContain('第1行'); // 值被藏起来了
  });

  it('回车提交的是**全文**（折叠从不丢数据）', async () => {
    const m = await ready();
    const payload = Array.from({ length: 8 }, (_, i) => `line-${i + 1}`).join('\n');

    await paste(m, payload);
    m.stdin.write('\r');
    await tick();

    expect(m.sent).toEqual([payload]);
  });

  it('任意编辑键先展开（回车前能看一眼全文）', async () => {
    const m = await ready();
    const payload = Array.from({ length: 7 }, (_, i) => `row-${i + 1}`).join('\n');
    await paste(m, payload);

    m.stdin.write(LEFT);
    await tick();

    const f = m.lastFrame() ?? '';
    expect(f).not.toContain('paste_folded');
    expect(f).toContain('row-1');
  });

  it('不带 bracketed 标记的超长单行也折（老终端上大粘贴就是一整块字节）', async () => {
    const m = await ready();
    m.stdin.write('x'.repeat(650));
    await waitFor(() => m.lastFrame()?.includes('paste_folded') === true);
    expect(m.lastFrame() ?? '').toContain('paste_folded(1)');
  });

  it('小粘贴不折（粘两行片段不该被藏起来）', async () => {
    const m = await ready();
    await paste(m, '小片段第一行\n小片段第二行');

    const f = m.lastFrame() ?? '';
    expect(f).not.toContain('paste_folded');
    expect(f).toContain('小片段第一行');
  });
});

describe('纯函数（历史来源与折叠门槛）', () => {
  it('parseHistoryLines 与 Python 的 _history_entries 同口径', () => {
    // prompt_toolkit 的 FileHistory 会写 "# 时间戳" 与 "+内容" 两种行
    const raw = '# 2026-01-01 10:00\n+你好\n+你好\n\n+世界\r\n';
    expect(parseHistoryLines(raw)).toEqual(['你好', '世界']);
    expect(parseHistoryLines('')).toEqual([]);
  });

  it('filterHistory：子串匹配 + 最近的排最前（与 dsh 的 Chat.tsx:3527 同序）', () => {
    const all = ['看 DeepSeek 的文档', '改一下这个 bug', 'deepseek 的 key 在哪'];
    expect(filterHistory(all, 'DEEPSEEK')).toEqual([
      'deepseek 的 key 在哪',
      '看 DeepSeek 的文档',
    ]);
    expect(filterHistory(all, '')).toEqual([...all].reverse());
    expect(filterHistory(all, 'zzz')).toEqual([]);
  });

  it('折叠门槛与 dsh 一致：≥6 行 或 ≥600 字符', () => {
    expect(isBigText('a\nb\nc\nd\ne')).toBe(false);
    expect(isBigText('a\nb\nc\nd\ne\nf')).toBe(true);
    expect(isBigText('x'.repeat(599))).toBe(false);
    expect(isBigText('x'.repeat(600))).toBe(true);
    // 两行的小粘贴：即使带 bracketed 标记也不折
    expect(foldLinesFor('a\nb', 'a\nb', true)).toBeNull();
    expect(foldLinesFor('a\nb', 'a\nb', false)).toBeNull();
    // 大块：折，并给出真实行数
    expect(foldLinesFor('x'.repeat(600), 'x'.repeat(600), false)).toBe(1);
    expect(foldLinesFor('a\nb\nc\nd\ne\nf', 'a\nb\nc\nd\ne\nf', true)).toBe(6);
  });
});
