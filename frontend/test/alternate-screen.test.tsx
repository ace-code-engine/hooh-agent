/**
 * 备用屏的进出 —— **必须成对**。
 *
 * 只测两件要命的事：进的时候写 `?1049h`、退出（卸载）时写 `?1049l`；
 * 以及非 TTY 时**一个字节都不写**（否则管道里会多出一串控制序列）。
 * 「没退干净 = 回到主屏一片空白」这种事故，只有这条能提前挡住。
 *
 * 注意时序：React 的 effect 清理**不在 `unmount()` 当场跑**，所以每次卸载后都要
 * 等一拍再断言 —— 否则第 1 条的"退出"会落进第 2 条的 spy 里（第一版就是这么红的）。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` → `./mount.js` 的 `mountTree()`（内核 `renderSync` + 假 stdio）；
 * `Text` 也从上游 `ink`（React 18）换成 `./helpers/kernel.js` 的内核 `Text`。
 * 断言一字未改。这里**必须**挂载/卸载真跑一遍（进屏在 effect 里、退屏在清理里），
 * 所以不能用一次性的 `renderLines`；spy 盯的仍是 `process.stdout`（组件自己写的那条路）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlternateScreen } from '../src/tui/alternate-screen.js';
import { Text } from './helpers/kernel.js';
import { mountTree } from './mount.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

afterEach(() => vi.restoreAllMocks());

/** 挂载 → 卸载 → 收集全部写入（卸载后多等两拍，保证清理跑完）。 */
async function writtenWith(isTTY: boolean): Promise<string> {
  const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
  const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const tree = mountTree(
    <AlternateScreen>
      <Text>全屏内容</Text>
    </AlternateScreen>,
  );
  await tick();
  tree.unmount();
  await tick();
  await tick();
  const written = spy.mock.calls.map((c) => String(c[0])).join('');
  if (desc) Object.defineProperty(process.stdout, 'isTTY', desc);
  return written;
}

describe('备用屏', () => {
  it('TTY 下进入写 `?1049h`、卸载写 `?1049l`（成对，且顺序正确）', async () => {
    const written = await writtenWith(true);
    expect(written).toContain('\x1b[?1049h');
    expect(written).toContain('\x1b[?1049l');
    expect(written.indexOf('\x1b[?1049h')).toBeLessThan(written.indexOf('\x1b[?1049l'));
  });

  it('非 TTY 一个控制序列都不写（管道/测试环境）', async () => {
    const written = await writtenWith(false);
    expect(written).not.toContain('1049');
    expect(written).not.toContain('?25');
  });
});
