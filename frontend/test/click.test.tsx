/**
 * 鼠标点击的**边界**断言 —— 结论：主屏（我们的默认模式）下内核**故意不派发**点击。
 *
 * ## 为什么这个文件值得存在（而不是干脆不写）
 *
 * "所有东西都应该能点"听起来是对的，但在这台内核上**做不到**，原因不在我们：
 * `lib/types/ink/ink.js` 的 `dispatchClick` / `dispatchContextMenu` 开头都是
 *
 * ```js
 * if (!this.altScreenActive) { logMouseDebug('dispatchClick skipped — alt screen inactive', …); return false; }
 * ```
 *
 * 主屏下帧只占屏幕底部一块，而鼠标报的是**绝对屏幕坐标** —— 映射不回帧行；
 * 上游自己选择不解决，只在备用屏（`--fullscreen`）里派发。这条用内核自带的
 * `DSH_TUI_DEBUG_MOUSE=1` 日志实证过：事件到了（`mouse arrive {col,row}`）、
 * 坐标也对，紧接着就是 `dispatchClick skipped — alt screen inactive`。
 *
 * ## 组件侧已经接好（但在这条断言里验不到）
 *
 * `ListItem` 的 `onClick` / `onHover`、`Picker` 的"点一项 = 选它"都已接线：
 * 备用屏下内核一开闸就能用。**本文件不假装它已经端到端验过** —— 套件里驱动不了
 * 备用屏那条路（`<AlternateScreen>` 挂载后，合成的 stdin 写入不再被消费；
 * 内核自己的 `alt-screen enter {inkFound:true}` 说明 `setAltScreenActive(true)` 是调到了，
 * 但鼠标序列进不去）。所以这里只钉"主屏下点不动"这个**事实**，谁想改成可点，
 * 得先解决坐标映射，而不是加个 `onClick` 了事。
 */

import { describe, expect, it } from 'vitest';

import { ListItem } from '../src/components/design-system/index.js';
import { Box } from '../vendor/dsh-ink/kernel.js';
import { mountTree, waitFor } from './mount.js';

const noColor = (): string | undefined => undefined;

describe('内核的门：主屏下点击被丢弃（不是我们没接）', () => {
  it('往 stdin 发真的 SGR 鼠标序列，`onClick` 不会被调用', async () => {
    const fired: string[] = [];
    const m = mountTree(
      <Box flexDirection="column">
        <ListItem label="第一项" color={noColor} onClick={() => fired.push('1')} />
        <ListItem label="第二项" color={noColor} onClick={() => fired.push('2')} />
      </Box>,
      { width: 40 },
    );
    await waitFor(() => m.frames.length > 0, 300);
    // SGR 鼠标：按下 + 松开，行列都是 1 起算
    m.stdin.write('\u001b[<0;5;2M');
    m.stdin.write('\u001b[<0;5;2m');
    await waitFor(() => fired.length > 0, 300);
    m.unmount();
    expect(fired).toEqual([]);
  });
});
