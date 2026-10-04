/**
 * 选择器外壳 —— 按键序列 → **帧内容**的实测证据（`mountTree()`，见 `test/mount.tsx`）。
 *
 * ## 这组用例想钉住什么
 *
 * 1. **窗口算术**（纯函数）：焦点永远在窗口里、行预算被如实遵守、组标题行不白画；
 * 2. **键位语义**：`↑↓` 移动 / `PgUp·PgDn` 翻页 / `Tab` 切多选 / `Enter` 确认 / `Esc` 取消
 *    （与上游 dsh-TUI 的差异：他们的 Tab 是"接受补全"、多选在 MigratePicker 里是空格，
 *    我们统一成 Tab 切勾选 → 见 `src/components/pickers/Picker.tsx` 文件头差异 ②）；
 * 3. **边界不环绕**：到顶/到底就停（与 ace `render/menu.windowBounds` 同口径）。
 *
 * ## 文案
 *
 * 本文件的 `t` 用的是**本地小词典**，值就是「新增 i18n 键应该长什么样」的可读版
 * （真值在 `locales/{zh,en,ja}.json`，本波由另一位写手补齐，见报告）。这样断言不依赖
 * 三语文件是否已经补上，同时又逐句钉住了渲染结果。
 */

import { describe, expect, it } from 'vitest';

import {
  Picker,
  clampFocus,
  listWindow,
  moveFocus,
  pickerWindow,
  toggleKey,
  type PickerItem,
  type PickerProps,
} from '../src/components/pickers/index.js';
import { displayWidth } from '../src/render/text.js';
import { mountTree, type MountedTree } from './mount.js';

// ───────────────────────────────────────────────────────── 工具

const DICT: Record<string, string> = {
  picker_count: '{n} items',
  picker_selected: '{n} selected',
  picker_empty: '(nothing to pick)',
  picker_more_below: '  v {n} more below',
  menu_more_above: '  ^ {n} more above',
  picker_hint_single: 'up/down move - PgUp/PgDn page - Enter confirm - Esc cancel',
  picker_hint_multi: 'up/down move - Tab toggle - Enter confirm - Esc cancel',
};

const t = (key: string, params?: Record<string, string | number>): string =>
  (DICT[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params ?? {}, name) ? String(params![name]) : whole,
  );

const noColor = (): string | undefined => undefined;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

/** 最后一帧 → 文本行（剥掉 BSU/ESU 与 OSC 这类控制序列；组件本身不着色）。 */
function frame(tree: MountedTree): string[] {
  return (tree.lastFrame() ?? '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .split('\n');
}

const CMD_ITEMS: PickerItem[] = [
  { key: 'help', label: '/help', group: 'Session' },
  { key: 'exit', label: '/exit', group: 'Session' },
  { key: 'model', label: '/model', description: 'switch model', group: 'Model' },
];

function mount(props: Partial<PickerProps> = {}, width = 60): MountedTree {
  return mountTree(
    <Picker
      title="Commands"
      items={CMD_ITEMS}
      t={t}
      color={noColor}
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />,
    { width },
  );
}

/** 逐键发送（每键之间等内核冲刷，否则重渲染会被合并掉）。 */
async function press(tree: MountedTree, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    tree.stdin.write(k);
    // 孤立 ESC 在内核里是"可能是 Alt+键 的前缀"，要等 ~50ms 超时才当 Esc 吐出来；
    // 别的键立刻生效。多等两拍是**按键解析时序**，不是 Esc 不生效（同 app.test.tsx:141-145）。
    await tick();
    if (k === ESC) {
      await tick();
      await tick();
    }
  }
}

const DOWN = '\u001b[B';
const UP = '\u001b[A';
const PGUP = '\u001b[5~';
const PGDN = '\u001b[6~';
const TAB = '\t';
const ENTER = '\r';
const ESC = '\u001b';

// ───────────────────────────────────────────────────────── 纯函数

describe('选择器 · 窗口算术（纯函数）', () => {
  it('listWindow：焦点永远在窗口里；空列表 / 非法预算都不炸', () => {
    expect(listWindow([], 0, 5)).toEqual({ start: 0, end: 0 });
    const rows = Array.from({ length: 20 }, () => 1);
    for (let focus = 0; focus < 20; focus++) {
      const { start, end } = listWindow(rows, focus, 5);
      expect(start).toBeLessThanOrEqual(focus);
      expect(end).toBeGreaterThan(focus);
      expect(end - start).toBeLessThanOrEqual(5);
    }
    expect(listWindow(rows, 3, Number.NaN)).toEqual({ start: 3, end: 4 });
    // 越界焦点先被夹到末项，窗口再从那里往前铺（所以起点不是 1 而是 0）
    expect(listWindow([1, 1], 99, 5)).toEqual({ start: 0, end: 2 });
  });

  it('listWindow：预算装不下焦点项时，宁可超预算也不让光标跑出屏幕', () => {
    // 焦点项自身 3 行，预算只有 2 行
    expect(listWindow([1, 3, 1], 1, 2)).toEqual({ start: 1, end: 2 });
  });

  it('listWindow：从焦点向两侧交替扩张（两侧都不挤爆）', () => {
    const rows = Array.from({ length: 9 }, () => 1);
    expect(listWindow(rows, 4, 5)).toEqual({ start: 2, end: 7 });
    expect(listWindow(rows, 0, 4)).toEqual({ start: 0, end: 4 });
    expect(listWindow(rows, 8, 4)).toEqual({ start: 5, end: 9 });
  });

  it('pickerWindow：组标题行算进预算（上下裁剪按**项**计数）', () => {
    const rows = [
      { height: 1, group: 'A' },
      { height: 1, group: 'A' },
      { height: 1, group: 'B' },
      { height: 1, group: 'B' },
    ];
    // A 的标题占 1 行 → 预算 3 行只装得下 A(标题) + A + B(标题)
    expect(pickerWindow(rows, 0, 3)).toEqual({ start: 0, end: 2, leadGroup: undefined, hiddenAbove: 0, hiddenBelow: 2 });
    expect(pickerWindow(rows, 3, 3)).toEqual({ start: 2, end: 4, leadGroup: undefined, hiddenAbove: 2, hiddenBelow: 0 });
    expect(pickerWindow([], 0, 3)).toEqual({ start: 0, end: 0, leadGroup: undefined, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it('★pickerWindow：窗口首项落在组中段 → 补一行组标题，且不从预算里超支', () => {
    const rows = Array.from({ length: 5 }, () => ({ height: 1, group: 'A' }));
    const win = pickerWindow(rows, 4, 2);
    expect(win.leadGroup).toBe('A');
    // 画出来的行数 = 补的 1 行标题 + 窗口里的项数 ≤ 预算
    expect(1 + (win.end - win.start)).toBeLessThanOrEqual(2);
    // 首项正好是组第一条（标题那 1 行已经在 heights 里）→ 不需要补
    expect(pickerWindow(rows, 0, 2).leadGroup).toBeUndefined();
  });

  it('moveFocus / clampFocus：夹边界、不环绕、NaN 不动', () => {
    expect(clampFocus(-3, 5)).toBe(0);
    expect(clampFocus(99, 5)).toBe(4);
    expect(clampFocus(2, 0)).toBe(0);
    expect(clampFocus(Number.NaN, 5)).toBe(0);
    expect(moveFocus(0, -1, 5)).toBe(0);   // 到顶就停，**不绕到末项**
    expect(moveFocus(4, 1, 5)).toBe(4);    // 到底就停
    expect(moveFocus(2, -2, 5)).toBe(0);
    expect(moveFocus(2, Number.NaN, 5)).toBe(2);
  });

  it('toggleKey：加/删都返回新数组，顺序 = 勾选先后', () => {
    const a = toggleKey([], 'x');
    expect(a).toEqual(['x']);
    const b = toggleKey(a, 'y');
    expect(b).toEqual(['x', 'y']);
    expect(toggleKey(b, 'x')).toEqual(['y']);
    expect(a).toEqual(['x']);               // 原数组没被改
  });
});

// ───────────────────────────────────────────────────────── 按键 → 帧

describe('选择器 · 首帧（未按键）', () => {
  it('标题带计数 + 组标题只在该组首条处出现一次 + ❯ 在首项', async () => {
    const tree = mount();
    await tick();
    const lines = frame(tree);
    expect(lines).toContain('Commands · 3 items');
    expect(lines.filter((l) => l.includes('-- Session'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('-- Model'))).toHaveLength(1);
    expect(lines).toContain('  ❯ /help');
    expect(lines).toContain('    /exit');
    expect(lines.some((l) => l.includes('Enter confirm'))).toBe(true);
    tree.unmount();
  });

  it('说明行只占一行、缩进在标签下方（行高恒定是窗口算术的前提）', async () => {
    const tree = mount();
    await tick();
    const lines = frame(tree);
    // /model 两行：`  ❯ /model` 不可能同时是焦点，但说明行必须存在且独立成行
    expect(lines).toContain('    switch model');
    tree.unmount();
  });
});

describe('选择器 · 移动与翻页', () => {
  it('↓ 把 ❯ 移到第二项（帧里光标位置变了，不是只改了内部状态）', async () => {
    const tree = mount();
    await tick();
    await press(tree, DOWN);
    const lines = frame(tree);
    expect(lines).toContain('  ❯ /exit');
    expect(lines).toContain('    /help');
    expect(lines.some((l) => l.includes('❯ /help'))).toBe(false);
    tree.unmount();
  });

  it('↑ 到顶就停：**不环绕**到末项', async () => {
    const tree = mount();
    await tick();
    await press(tree, UP);
    expect(frame(tree)).toContain('  ❯ /help');
    tree.unmount();
  });

  it('★PgDn 翻一屏 + 帧里如实报出上下各藏了几项；PgUp 回到顶部', async () => {
    const items: PickerItem[] = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, label: `item${i}` }));
    const tree = mount({ items, rows: 3 });
    await tick();
    await press(tree, PGDN);
    const after = frame(tree);
    expect(after).toContain('  ❯ item3');
    expect(after.some((l) => l.includes('^ 2 more above'))).toBe(true);
    expect(after.some((l) => l.includes('v 1 more below'))).toBe(true);
    await press(tree, PGUP);
    const top = frame(tree);
    expect(top).toContain('  ❯ item0');
    expect(top.some((l) => l.includes('more above'))).toBe(false);
    tree.unmount();
  });

  it('多行项下的翻页步长按**可见项数**算，不是固定 1 行', async () => {
    const items: PickerItem[] = Array.from({ length: 6 }, (_, i) => ({
      key: `k${i}`,
      label: `item${i}`,
      description: `desc${i}`,
    }));
    const tree = mount({ items, rows: 4 });   // 每项 2 行 → 一屏 2 项
    await tick();
    await press(tree, PGDN);
    expect(frame(tree)).toContain('  ❯ item2');
    tree.unmount();
  });
});

describe('选择器 · 多选（Tab 切勾选）', () => {
  const multiProps = { multi: true } as const;

  it('Tab 勾选 → 帧里 `[ ]` 变 `[x]`；再 Tab 取消失效', async () => {
    const tree = mount(multiProps);
    await tick();
    expect(frame(tree)).toContain('  ❯ [ ] /help');
    await press(tree, TAB);
    expect(frame(tree)).toContain('  ❯ [x] /help');
    expect(frame(tree).some((l) => l.includes('1 selected'))).toBe(true);
    await press(tree, TAB);
    expect(frame(tree)).toContain('  ❯ [ ] /help');
    expect(frame(tree).some((l) => l.includes('selected'))).toBe(false);
    tree.unmount();
  });

  it('★Enter 回传的是**勾选集合**（按列表顺序），不是焦点项', async () => {
    const got: Array<{ keys: string[]; key?: string; multi: boolean }> = [];
    const tree = mount({ ...multiProps, onConfirm: (r) => got.push({ ...r }) });
    await tick();
    await press(tree, TAB);          // 勾 /help
    await press(tree, DOWN, DOWN);   // 焦点走到 /model
    await press(tree, TAB);          // 勾 /model
    await press(tree, ENTER);
    expect(got).toEqual([{ key: 'model', keys: ['help', 'model'], multi: true }]);
    tree.unmount();
  });

  it('一个都没勾时 Enter 回退成焦点项（上游 MigratePicker 同口径）', async () => {
    const got: Array<{ keys: string[] }> = [];
    const tree = mount({ ...multiProps, onConfirm: (r) => got.push({ keys: r.keys }) });
    await tick();
    await press(tree, DOWN, ENTER);
    expect(got).toEqual([{ keys: ['exit'] }]);
    tree.unmount();
  });

  it('单选模式下 Tab 什么都不做（对照：键位差异是刻意的）', async () => {
    const tree = mount();
    await tick();
    const before = frame(tree).join('\n');
    await press(tree, TAB);
    expect(frame(tree).join('\n')).toBe(before);
    tree.unmount();
  });
});

describe('选择器 · 确认 / 取消 / 空态 / 不吃键', () => {
  it('Enter 回传焦点项；Esc 回传取消（两件事分开）', async () => {
    const confirmed: string[] = [];
    const cancelled: number[] = [];
    const a = mount({ onConfirm: (r) => confirmed.push(r.keys.join(',')) });
    await tick();
    await press(a, DOWN, ENTER);
    a.unmount();
    const b = mount({ onCancel: () => cancelled.push(1) });
    await tick();
    await press(b, ESC);
    b.unmount();
    expect(confirmed).toEqual(['exit']);
    expect(cancelled).toEqual([1]);
  });

  it('空态：0 项 → 画空态文案、标题不带计数、Enter 不回调、Esc 仍能取消', async () => {
    const confirmed: number[] = [];
    const cancelled: number[] = [];
    const tree = mount({
      items: [],
      onConfirm: () => confirmed.push(1),
      onCancel: () => cancelled.push(1),
    });
    await tick();
    const lines = frame(tree);
    expect(lines).toContain('Commands');
    expect(lines.some((l) => l.includes('items'))).toBe(false);
    expect(lines.some((l) => l.includes('(nothing to pick)'))).toBe(true);
    await press(tree, ENTER);
    expect(confirmed).toEqual([]);
    await press(tree, ESC);
    expect(cancelled).toEqual([1]);
    tree.unmount();
  });

  it('isActive=false 时不吃键（别的浮层开着的时候）', async () => {
    const tree = mount({ isActive: false });
    await tick();
    await press(tree, DOWN, ENTER);
    expect(frame(tree)).toContain('  ❯ /help');
    tree.unmount();
  });

  it('窄终端：标签与说明都按显示宽度截断，不会把行撑成两行', async () => {
    const items: PickerItem[] = [{ key: 'long', label: 'x'.repeat(80), description: 'y'.repeat(80) }];
    const tree = mount({ items }, 20);
    await tick();
    const lines = frame(tree);
    const labelLine = lines.find((l) => l.includes('❯'))!;
    const descLine = lines.find((l) => l.includes('y'))!;
    // 截断生效：两行都 ≤ 20 列，且尾部是省略号（Ink 自己折行的话这里会多出整行）
    expect(displayWidth(labelLine)).toBeLessThanOrEqual(20);
    expect(displayWidth(descLine)).toBeLessThanOrEqual(20);
    expect(labelLine.endsWith('…')).toBe(true);
    expect(descLine.endsWith('…')).toBe(true);
    tree.unmount();
  });
});
