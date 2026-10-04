/**
 * 滚动视口 —— 主屏靠终端回滚，**备用屏（全屏）只能靠自己这个视口**。
 *
 * 这一组盯三条语义（照 pi `ScrollView` 的口径）：
 *   ① 跟随尾部：新内容到来时贴底；
 *   ② 往上翻即脱离：翻上去后不被新内容拽回底部（这条不做好，翻历史是白翻）；
 *   ③ 翻回底部即恢复跟随；滚动条只在内容溢出时出现。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` → `./mount.js`（内核 `renderSync` + 假 stdio）；`Text` 也从上游
 * `ink`（React 18）换成 `./helpers/kernel.js` 的内核 `Text`。断言一字未改。
 * ✅ 复查（同日）：`src/**` 已整体换到内核（`from 'ink'` 清零），本文件随全量测试转绿。
 */

import { describe, expect, it } from 'vitest';

import { ScrollBox, clampOffset, windowRange } from '../src/tui/scroll-box.js';
import { Text } from './helpers/kernel.js';
import { mountTree, type MountedTree } from './mount.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));
const noColor = (): string | undefined => undefined;

const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `第${i}行`);

function frameOf(list: string[], height: number, active = true): MountedTree {
  return mountTree(
    <ScrollBox
      items={list}
      height={height}
      active={active}
      color={noColor}
      hint="↓ 跳到最新"
      renderItem={(it) => <Text key={it}>{it}</Text>}
    />,
  );
}

describe('ScrollBox 纯函数', () => {
  it('clampOffset 夹在 [0, total-height]，非法值回 0', () => {
    expect(clampOffset(-5, 10, 3)).toBe(0);
    expect(clampOffset(99, 10, 3)).toBe(7);
    expect(clampOffset(Number.NaN, 10, 3)).toBe(0);
    expect(clampOffset(3, 2, 5)).toBe(0);        // 内容比视口短
  });

  it('windowRange：跟随尾部取最后一段；不跟随时从偏移起', () => {
    expect(windowRange(0, 10, 3, true)).toEqual({ start: 7, end: 10 });
    expect(windowRange(2, 10, 3, false)).toEqual({ start: 2, end: 5 });
  });
});

describe('ScrollBox 渲染', () => {
  it('默认跟随尾部，只画最后 height 行', async () => {
    const tree = frameOf(items(10), 3);
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).toContain('第9行');
    expect(out).not.toContain('第1行');
    tree.unmount();
  });

  it('★往上翻就脱离跟随：新内容不会把人拽回底部（否则翻历史白翻）', async () => {
    const tree = frameOf(items(10), 3);
    await tick();
    tree.stdin.write('\x1b[5~');                  // PageUp
    await tick();
    const afterScroll = tree.lastFrame() ?? '';
    expect(afterScroll).toContain('↓ 跳到最新');  // 脱离跟随 → 出现提示
    tree.rerender(
      <ScrollBox
        items={items(20)}                         // 新内容到来
        height={3}
        active
        color={noColor}
        hint="↓ 跳到最新"
        renderItem={(it) => <Text key={it}>{it}</Text>}
      />,
    );
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).toContain('↓ 跳到最新');          // 仍在脱跟随状态
    expect(out).not.toContain('第19行');          // 没被拽到底
    tree.unmount();
  });

  it('★G 翻到底 → 恢复跟随（提示消失、显示最新行）', async () => {
    const tree = frameOf(items(10), 3);
    await tick();
    tree.stdin.write('\x1b[5~');
    await tick();
    tree.stdin.write('G');                        // 末页（Ink 5 收不到 End，用 G）
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).not.toContain('↓ 跳到最新');
    expect(out).toContain('第9行');
    tree.unmount();
  });

  it('内容没溢出 → 不画滚动条（省一列宽度）', async () => {
    const tree = frameOf(items(2), 5);
    await tick();
    expect(tree.lastFrame() ?? '').not.toContain('│');
    tree.unmount();
  });

  it('内容溢出 → 画滚动条', async () => {
    const tree = frameOf(items(30), 4);
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).toContain('│');
    expect(out).toContain('█');                   // 滑块
    tree.unmount();
  });

  it('active=false 时不抢键（对话框弹出来时）', async () => {
    const tree = frameOf(items(10), 3, false);
    await tick();
    tree.stdin.write('\x1b[5~');
    await tick();
    const out = tree.lastFrame() ?? '';
    expect(out).not.toContain('↓ 跳到最新');
    expect(out).toContain('第9行');
    tree.unmount();
  });
});
