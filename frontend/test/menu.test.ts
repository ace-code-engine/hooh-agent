/**
 * 补全菜单模型测试 —— 重点是**开合规则与回车语义**（那是肌肉记忆）。
 */

import { describe, expect, it } from 'vitest';

import {
  ARGUMENT_HINTS,
  MENTION_TRIGGERS,
  acceptedText,
  buildMenu,
  commandItems,
  describeWithCurrent,
  menuHintKey,
  tokenUnderCursor,
  windowBounds,
} from '../src/render/menu.js';

const COMMANDS = { '/help': 'cmd_help', '/model': 'cmd_model', '/permission': 'cmd_permission' };
const OPTS = { commands: COMMANDS, groupOf: () => 'group_session' };

const build = (text: string): ReturnType<typeof buildMenu> =>
  buildMenu(text, text.length, OPTS);

describe('开合规则', () => {
  it('`/` 开头 → 命令菜单', () => {
    const m = build('/');
    expect(m.open).toBe(true);
    expect(m.kind).toBe('/');
    expect(m.items.length).toBe(3);
  });

  it('`/he` 过滤到 /help', () => {
    expect(build('/he').items.map((i) => i.label)).toEqual(['/help']);
  });

  it('**命令已打全 → 菜单关闭**（用户不必按 Esc 关它，回车直接发送）', () => {
    const m = build('/help');
    // 菜单是**关**的：命令名已经和目标一致，没有东西可补
    expect(m.open).toBe(false);
    // 且回车语义确实是"发送"（补全结果与输入一致）
    expect(acceptedText(m, '/help')).toBe('/help');
  });

  it('**参数已选好 → 菜单关闭**（否则回车只会一直再补一个参数，永远发不出去）', () => {
    const m = build('/permission readonly ');
    expect(m.open).toBe(false);
    expect(acceptedText(m, '/permission readonly ')).toBe('/permission readonly ');
  });

  it('已用过的参数不再出现在候选里（不给"重复填同一个参数"的机会）', () => {
    const labels = build('/permission readonly w').items.map((i) => i.label);
    expect(labels).not.toContain('readonly');
  });

  it('普通文本 → 菜单关闭', () => {
    expect(build('帮我看看这段代码').open).toBe(false);
  });

  it('`@` 开头 → 提及菜单（四类触发词）', () => {
    const m = build('@');
    expect(m.open).toBe(true);
    expect(m.kind).toBe('@');
    expect(m.items.map((i) => i.label)).toEqual(MENTION_TRIGGERS.map(([k]) => `@${k}`));
  });

  it('`/permission ` 之后 → 参数菜单', () => {
    const m = build('/permission ');
    expect(m.open).toBe(true);
    expect(m.kind).toBe('/permission ');
    expect(m.items.map((i) => i.label)).toEqual(
      ARGUMENT_HINTS['/permission']!.map(([a]) => a),
    );
  });

  it('有固定取值的命令，打「前缀 + 空格」就把取值摆出来（不必自己抄）', () => {
    expect(build('/lang ').items.map((i) => i.label)).toEqual(['zh', 'en', 'ja']);
    expect(build('/effort ').items.map((i) => i.label)).toEqual([
      'auto', 'low', 'medium', 'high', 'max',
    ]);
    expect(build('/vim ').items.map((i) => i.label)).toEqual(['on', 'off']);
  });

  it('**选中命令后下一层立刻出来**：有取值表的命令，补全插进输入框时带上那个空格', () => {
    const items = commandItems({ '/todo': 'cmd_todo', '/status': 'cmd_status' }, {});
    const ins = Object.fromEntries(items.map((i) => [i.label, i.insert]));
    // 带空格 → 输入里已经有分隔符 → 菜单自然落到下一层（参数菜单）
    expect(ins['/todo']).toBe('/todo ');
    // 没有取值表的命令不带空格：打完回车直接发送
    expect(ins['/status']).toBe('/status');
    expect(buildMenu('/todo ', 6, OPTS).items.map((i) => i.label)).toEqual(
      ARGUMENT_HINTS['/todo']!.map(([a]) => a),
    );
  });

  it('`/permission r` 按子序列过滤（`write` 里的 r 也算命中，这是子序列匹配的定义）', () => {
    const labels = build('/permission r').items.map((i) => i.label);
    expect(labels).toContain('readonly');
    expect(labels).toContain('rules');
    // `write` 里 index 1 就是 r —— 子序列匹配认它。不认反而说明实现与 Python 侧不一致。
    expect(labels).toContain('write');
    // 前缀命中的 readonly/rules 该排在中间命中的 write 之前
    expect(labels.indexOf('readonly')).toBeLessThan(labels.indexOf('write'));
  });

  it('`/permission w` 才只留下 write', () => {
    expect(build('/permission w').items.map((i) => i.label)).toEqual(['write']);
  });

  it('没有参数提示的命令打空格后不弹参数菜单', () => {
    expect(build('/help ').open).toBe(false);
  });

  it('空输入不弹', () => {
    expect(build('').open).toBe(false);
  });
});

describe('回车语义（"菜单不碍事"的关键）', () => {
  it('候选与输入不同 → **先补全，不发送**', () => {
    const m = build('/he');
    expect(acceptedText(m, '/he')).toBe('/help');
  });

  it('候选与输入一致 → 不改变文本（于是回车会走发送）', () => {
    const m = build('/help');
    expect(acceptedText(m, '/help')).toBe('/help');
  });

  it('补全替换的是**当前词**，不是整行', () => {
    const text = '随便说点什么 /he';
    const m = buildMenu(text, text.length, OPTS);
    expect(acceptedText(m, text)).toBe('随便说点什么 /help');
  });

  it('参数补全带尾随空格（方便接着打）', () => {
    const m = build('/permission re');
    expect(acceptedText(m, '/permission re')).toBe('/permission readonly ');
  });

  it('提及补全带尾随空格；`@lang` 这类带空格触发取值', () => {
    const m = build('@');
    expect(acceptedText(m, '@')).toBe('@lang ');
  });
});

describe('选中项移动', () => {
  it('循环：到底再按一下回到开头', () => {
    const m = build('/');
    const n = m.items.length;
    const moved = { ...m, selected: (m.selected + 1) % n };
    expect(moved.selected).toBe(1);
    const wrapped = { ...m, selected: (n - 1 + 1) % n };
    expect(wrapped.selected).toBe(0);
  });
});

describe('窗口裁剪 —— 选中项必须始终可见', () => {
  it('候选少于高度时全显示', () => {
    expect(windowBounds(3, 0, 8)).toEqual({ from: 0, to: 3, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it('选中项在两头时不越界', () => {
    const first = windowBounds(20, 0, 5);
    expect(first.from).toBe(0);
    expect(first.hiddenAbove).toBe(0);

    const last = windowBounds(20, 19, 5);
    expect(last.to).toBe(20);
    expect(last.hiddenBelow).toBe(0);
  });

  it('**任何选中位置都在窗口内**（整段扫一遍）', () => {
    const total = 30;
    const h = 7;
    for (let sel = 0; sel < total; sel++) {
      const { from, to } = windowBounds(total, sel, h);
      expect(sel, `selected=${sel} 落在 [${from},${to})`).toBeGreaterThanOrEqual(from);
      expect(sel, `selected=${sel} 落在 [${from},${to})`).toBeLessThan(to);
      expect(to - from).toBeLessThanOrEqual(h);
    }
  });

  it('被挡住的数量如实报出', () => {
    const b = windowBounds(30, 15, 7);
    expect(b.hiddenAbove).toBeGreaterThan(0);
    expect(b.hiddenBelow).toBeGreaterThan(0);
    expect(b.hiddenAbove + (b.to - b.from) + b.hiddenBelow).toBe(30);
  });

  it('高度为 0 按最小高度 1 处理（不崩、也不给出空窗口）', () => {
    const b = windowBounds(10, 5, 0);
    expect(b.to - b.from).toBe(1);
    expect(b.from).toBeLessThanOrEqual(5);
    expect(b.to).toBeGreaterThan(5);
  });
});

describe('「（当前 xxx）」内联 —— 与主页"每行右侧给当前值"同一条口径', () => {
  const state = {
    model: 'deepseek-v4-flash',
    permission: 'readonly',
    sandbox: 'job',
    effort: 'medium',
    net: 'on',
    lang: 'zh',
    vim: false,
  };
  const tr = (k: string): string =>
    ({ arg_on: '开', arg_off: '关', menu_current_value: '（当前 {value}）' })[k] ?? k;

  it('有状态的命令带上当前值', () => {
    expect(describeWithCurrent('/model', '切换模型', state, tr)).toBe('切换模型 （当前 deepseek-v4-flash）');
    expect(describeWithCurrent('/sandbox', '切换沙箱', state, tr)).toBe('切换沙箱 （当前 job）');
  });

  it('开关类字段翻译成开/关，不显示 on/off', () => {
    expect(describeWithCurrent('/net', '联网', state, tr)).toContain('（当前 开）');
    expect(describeWithCurrent('/vim', 'vi 模式', state, tr)).toContain('（当前 关）');
  });

  it('无状态的命令**不加尾巴**（别给每条都挂一个空括注）', () => {
    expect(describeWithCurrent('/help', '显示帮助', state, tr)).toBe('显示帮助');
    expect(describeWithCurrent('/exit', '退出', state, tr)).toBe('退出');
  });

  it('**取不到值时不显示「当前 ??」** —— 那比不显示更糟，用户会以为状态丢了', () => {
    expect(describeWithCurrent('/model', '切换模型', {}, tr)).toBe('切换模型');
    expect(describeWithCurrent('/model', '切换模型', { model: '' }, tr)).toBe('切换模型');
  });

  it('菜单候选真的带上了当前值（走完整 buildMenu 链路）', () => {
    const m = buildMenu('/', 1, {
      commands: { '/model': 'cmd_model', '/help': 'cmd_help' },
      groupOf: () => 'group_session',
      translate: (k) => (k === 'cmd_model' ? '切换模型' : k === 'menu_current_value' ? '（当前 {value}）' : k),
      state,
    });
    const model = m.items.find((i) => i.label === '/model');
    expect(model?.desc).toContain('deepseek-v4-flash');
    // 无状态的命令不该被波及
    expect(m.items.find((i) => i.label === '/help')?.desc).not.toContain('当前');
  });
});

describe('提示行按菜单类型选（复用 Python 侧已有的三个键）', () => {
  it('命令 / 提及 / 参数各一个键', () => {
    expect(menuHintKey(build('/'))).toBe('menu_hint_command');
    expect(menuHintKey(build('@'))).toBe('menu_hint_mention');
    expect(menuHintKey(build('/permission '))).toBe('menu_hint_arg');
  });
});

describe('光标处的词', () => {
  it('以空白为界，`/` `@` 也算词首', () => {
    expect(tokenUnderCursor('/he', 3)).toEqual(['/he', 0, 3]);
    expect(tokenUnderCursor('说点 /he', 6)).toEqual(['/he', 3, 6]);
  });

  it('光标在词中间时取整个词', () => {
    expect(tokenUnderCursor('/help', 2)).toEqual(['/help', 0, 5]);
  });

  it('越界的光标被夹住，不崩', () => {
    expect(tokenUnderCursor('ab', 99)).toEqual(['ab', 0, 2]);
    expect(tokenUnderCursor('ab', -5)).toEqual(['ab', 0, 2]);
  });
});
