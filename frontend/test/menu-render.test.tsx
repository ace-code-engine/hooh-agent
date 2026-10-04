/**
 * `Menu` 组件的渲染测试 —— **补一道之前不存在的防线**。
 *
 * 为什么单开一个文件：`menu.test.ts` 测的是菜单**模型**（纯函数），
 * `app.test.tsx` 里 `setup()` 从不传 `menuOptions`，所以 **`Menu.tsx` 从来没被渲染过**。
 * 结果是我加"分组标题"那次，模型算得对、组件画出来却是错的 —— 同一组的标题
 * 重复出现、条目跨组交错，而所有测试全绿。
 *
 * 教训：**纯函数测过不等于画出来对**。组件至少要有一处把它渲染出来看一眼。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` 的 `render()` / `lastFrame()` → `./helpers/screen.js` 的 `renderLines()`
 * （内核 `renderToScreen`：同步、纯 buffer）。**断言一个字没改**，只去掉了 `await tick()`
 * （返回时帧已经画完），并把宽度显式传给 `renderLines`（老工具的 100 列来自假 stdout）。
 * 拿到的是**纯文本**（无 ANSI），`split('\n')` / `displayWidth` 这类断言比原来更稳。
 */

import { describe, expect, it } from 'vitest';

import { Menu } from '../src/components/Menu.js';
import { buildMenu, type BuildMenuOptions } from '../src/render/menu.js';
import { renderLines } from './helpers/screen.js';

const t = (k: string): string => k;
const noColor = (): string | undefined => undefined;

/** 模拟引擎现在**按分组顺序**下发的命令表（`grouped_commands()` 的序）。 */
const GROUPED: Record<string, string> = {
  '/help': 'cmd_help',
  '/clear': 'cmd_clear',
  '/model': 'cmd_model',
  '/provider': 'cmd_provider',
};
const GROUP_OF: Record<string, string> = {
  '/help': 'group_session',
  '/clear': 'group_session',
  '/model': 'group_model',
  '/provider': 'group_model',
};
const OPTS: BuildMenuOptions = {
  commands: GROUPED,
  groupOf: (n) => GROUP_OF[n] ?? 'group_more',
  translate: t,
};

function frame(text: string, width = 100): string {
  const st = buildMenu(text, text.length, OPTS);
  return renderLines(<Menu state={st} t={t} color={noColor} width={width} />, width).text;
}

const lines = (f: string): string[] =>
  f.split('\n').map((l) => l.replace(/^[│╭╰]\s?/, '').trimEnd());

describe('分组标题', () => {
  it('每组标题**只出现一次**', () => {
    const out = frame('/');
    expect(out.split('group_session').length - 1).toBe(1);
    expect(out.split('group_model').length - 1).toBe(1);
  });

  it('标题在**该组第一条之前**，同组条目连在一起', () => {
    const ls = lines(frame('/'));
    const iSession = ls.findIndex((l) => l.includes('group_session'));
    const iModel = ls.findIndex((l) => l.includes('group_model'));
    const iHelp = ls.findIndex((l) => l.includes('/help'));
    const iClear = ls.findIndex((l) => l.includes('/clear'));
    const iModelCmd = ls.findIndex((l) => l.includes('/model  '));

    expect(iSession).toBeLessThan(iHelp);
    expect(iHelp).toBeLessThan(iClear);
    expect(iClear).toBeLessThan(iModel); // 会话组全部排在模型组前面
    expect(iModel).toBeLessThan(iModelCmd);
  });

  it('**顺序乱了也不出重复标题**（防御：引擎若换了序，界面至少不会一眼就错）', () => {
    // 故意交错：session → model → session
    const interleaved: BuildMenuOptions = {
      commands: { '/help': 'cmd_help', '/model': 'cmd_model', '/clear': 'cmd_clear' },
      groupOf: (n) => GROUP_OF[n] ?? 'group_more',
      translate: t,
    };
    const st = buildMenu('/', 1, interleaved);
    const out = renderLines(<Menu state={st} t={t} color={noColor} width={100} />, 100).text;
    expect(out.split('group_session').length - 1).toBe(1);
  });
});

describe('渲染本身', () => {
  it('候选与说明都画出来了，选中项有标记', () => {
    const out = frame('/');
    expect(out).toContain('/help');
    expect(out).toContain('cmd_help');
    expect(out).toContain('▶');
  });

  it('提及菜单五类触发词都在（含 `@session`）', () => {
    const out = frame('@');
    for (const k of ['@lang', '@skill', '@file', '@folder', '@session']) {
      expect(out, k).toContain(k);
    }
  });

  it('**窄终端下不崩**：长说明被截断，命令名留着', () => {
    // 说明要够长才会触发截断 —— 短说明在窄宽度下也放得下，测不出这件事
    const opts: BuildMenuOptions = {
      commands: { '/help': 'cmd_help' },
      groupOf: () => 'group_session',
      translate: (k) =>
        k === 'cmd_help' ? '这是一段很长的说明文字，窄终端里放不下必须截断' : k,
    };
    const st = buildMenu('/', 1, opts);
    const out = renderLines(<Menu state={st} t={t} color={noColor} width={40} />, 40).text;
    expect(out).toContain('/help'); // 命令名必须在
    expect(out).toContain('…'); // 说明被截断
  });

  it('选中项滚动到可见范围时**一定画得出来**', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 30; i++) many[`/c${i}`] = `cmd_c${i}`;
    const st = buildMenu('/', 1, {
      commands: many,
      groupOf: () => 'group_more',
      translate: t,
    });
    // 默认**不截断**：30 条全在菜单状态里（此前默认只留 12 条，滚到底也看不见后面的，
    // 用户会以为命令就只有这么多）。窗口由 Menu 组件负责，不在这里砍。
    expect(st.items.length).toBe(30);
    st.selected = 25;
    const out = renderLines(
      <Menu state={st} t={t} color={noColor} width={100} height={8} />,
      100,
    ).text;
    const sel = out.split('\n').find((l) => l.includes('▶'));
    expect(sel, '选中项必须有一行带 ▶').toBeTruthy();
  });

  it('**选中项越界时也画得出标记**（夹到末项，而不是一个都不画）', () => {
    // 这是修过的真 bug：`windowBounds` 内部夹了 selected，而画标记那行比的还是
    // 原始值 —— 越界时窗口绕着末项滚、`▶` 却一个都不画，菜单看着像坏了。
    const st = buildMenu('/', 1, { commands: GROUPED, groupOf: (n) => GROUP_OF[n]!, translate: t });
    st.selected = 999;
    const out = renderLines(<Menu state={st} t={t} color={noColor} width={100} />, 100).text;
    const sel = out.split('\n').find((l) => l.includes('▶'));
    expect(sel, '越界时也该夹到末项并画出来').toBeTruthy();
  });
});
