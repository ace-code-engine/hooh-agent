/**
 * 备用屏的进出 —— **必须成对**。
 *
 * 只测两件要命的事：进的时候写 `?1049h`、退出（卸载）时写 `?1049l`；
 * 以及非 TTY 时**一个字节都不写**（否则管道里会多出一串控制序列）。
 * 「没退干净 = 回到主屏一片空白」这种事故，只有这条能提前挡住。
 *
 * 注意时序：React 的 effect 清理**不在 `unmount()` 当场跑**，所以每次卸载后都要
 * 等一拍再断言 —— 否则第 1 条的"退出"会落进第 2 条的 spy 里（第一版就是这么红的）。
 */

import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlternateScreen } from '../src/tui/alternate-screen.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

afterEach(() => vi.restoreAllMocks());

/** 挂载 → 卸载 → 收集全部写入（卸载后多等两拍，保证清理跑完）。 */
async function writtenWith(isTTY: boolean): Promise<string> {
  const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
  const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const tree = render(
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
