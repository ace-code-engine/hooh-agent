/**
 * `Input` 组件的**排队显示**测试 —— 补一道此前不存在的防线。
 *
 * 为什么单开一个文件：`menu.test.ts` 测的是纯函数、`app.test.tsx` 不驱真实按键，
 * 于是 `Input` 里那段"忙时按回车 = 排队"的状态**从来没被渲染出来过**。
 * 实测后果：底栏永远挂着"已排队 N 条"（数组只增不减），而屏幕上一切正常 ——
 * 用户只会觉得"它卡住了"。
 *
 * 注意用例里一律用**普通文本**而不是 `/net`：命令名会被补全菜单接住（回车先补全、
 * 不发送）—— 那是本文件之外的另一条正确行为，混进来只会让这里测不准。
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { Input } from '../src/components/Input.js';

const t = (k: string, params?: Record<string, string | number>): string =>
  params ? `${k}(${Object.values(params).join(',')})` : k;
const noColor = (): string | undefined => undefined;
/** 等两拍：Ink 的 setState + 重渲染是异步的，写一次键后要让它落下来。 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

interface Mounted {
  lastFrame: () => string | undefined;
  rerender: (busy: boolean) => void;
  stdin: { write: (s: string) => void };
}

function mount(busy: boolean): Mounted {
  const props = { t, color: noColor, onSubmit: () => true, width: 80, vim: false };
  const r = render(<Input {...props} busy={busy} />);
  return {
    lastFrame: r.lastFrame,
    stdin: r.stdin,
    rerender: (b: boolean) => r.rerender(<Input {...props} busy={b} />),
  };
}

/** 起手必须等首帧：`useInput` 是在 effect 里订阅的，订阅前 write 的键**会被丢掉**。 */
async function mountReady(busy: boolean): Promise<Mounted> {
  const m = mount(busy);
  await tick();
  return m;
}

describe('忙时排队', () => {
  it('忙时回车 → 显示"已排队 1 条"（消息已经发出去了，这是提示不是缓冲）', async () => {
    const m = await mountReady(true);
    m.stdin.write('看一下这个文件');
    await tick();
    m.stdin.write('\r');
    await tick();
    expect(m.lastFrame()).toContain('input_queued_n(1)');
  });

  it('**一轮结束后提示必须消失**（此前只增不减，底栏永远挂着"已排队"）', async () => {
    const m = await mountReady(true);
    m.stdin.write('看一下这个文件');
    await tick();
    m.stdin.write('\r');
    await tick();
    expect(m.lastFrame()).toContain('input_queued_n(1)');

    m.rerender(false); // ← 引擎那一轮结束了
    await tick();
    expect(m.lastFrame()).not.toContain('input_queued_n');
  });

  it('不忙时回车不排队（正常发送）', async () => {
    const m = await mountReady(false);
    m.stdin.write('看一下这个文件');
    await tick();
    m.stdin.write('\r');
    await tick();
    expect(m.lastFrame()).not.toContain('input_queued_n');
  });
});
