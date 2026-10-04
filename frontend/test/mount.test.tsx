/**
 * 交互式挂载工具（`test/mount.tsx`）的**自检** —— 这套基建自己也要有人看着。
 *
 * 为什么需要：`mount()` 是"按键 → 重渲染 → 出帧"这条链的唯一通道，它坏掉时
 * 症状是**所有交互用例一起空过**（`lastFrame()` 恒为 undefined 或旧帧），
 * 而不是报错。所以它必须有一条**今天就能跑**的最小证据链：
 *   挂载出帧 → `stdin.write` 驱动状态 → `rerender` 换 props → `unmount` 后不再出帧。
 */

import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Text, useInput } from '../vendor/dsh-ink/kernel.js';
import { mountTree } from './mount.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

/** 最小交互组件：一个键改一次状态。 */
function Counter(): React.ReactElement {
  const [n, setN] = useState(0);
  useInput((input) => {
    if (input === '+') setN((v) => v + 1);
  });
  return <Text>n={n}</Text>;
}

describe('交互式挂载工具自检', () => {
  it('挂载就出帧（非 TTY 路径写的是**整屏**，不是增量 diff）', async () => {
    const tree = mountTree(<Counter />);
    await tick();
    expect(tree.lastFrame()).toContain('n=0');
    expect(tree.frames.length).toBeGreaterThan(0);
    tree.unmount();
  });

  it('`stdin.write` 真的能驱动状态（按键 → 重渲染 → 新帧）', async () => {
    const tree = mountTree(<Counter />);
    await tick();
    tree.stdin.write('+');
    await tick();
    expect(tree.lastFrame()).toContain('n=1');
    tree.stdin.write('+');
    await tick();
    expect(tree.lastFrame()).toContain('n=2');
    tree.unmount();
  });

  it('`rerender` 换 props、`unmount` 之后不再出帧', async () => {
    const tree = mountTree(<Text>甲</Text>);
    await tick();
    expect(tree.lastFrame()).toContain('甲');
    tree.rerender(<Text>乙</Text>);
    await tick();
    expect(tree.lastFrame()).toContain('乙');
    tree.unmount();
    const framesAfterUnmount = tree.frames.length;
    await tick();
    expect(tree.frames.length).toBe(framesAfterUnmount);
  });

  it('宽度跟着假 stdout 的 `columns` 走（默认 100，与老工具一致）', async () => {
    const wide = mountTree(<Text>甲甲</Text>);
    await tick();
    // 100 列：一行就是 100 列宽（行尾空白被 trim 掉的是渲染后的空白，不是列数）
    expect(wide.stdout.columns).toBe(100);
    wide.unmount();
  });
});
