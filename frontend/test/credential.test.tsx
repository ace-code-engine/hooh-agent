/**
 * 凭据输入**不许回显**（H-34a）。
 *
 * 为什么单开一个文件：`ChoiceDialog` 的 `text` 分支此前**没有任何渲染断言** ——
 * `app.test.tsx` 只喂 `kind='choose'`，于是"API Key 被逐字画在屏幕上"这件事
 * 所有测试全绿。与 `menu-render.test.tsx` 同一个教训：**纯函数测过 ≠ 画出来对**；
 * 而这一条比排版错误严重得多 —— 引擎给的提示词自己写着"（输入时不显示）"。
 *
 * ## 两个必须写对的细节（否则这文件会**假通过**）
 *
 * 1. **`await tick()` 必须在第一次 `stdin.write` 之前**：`render()` 返回时 Ink 还没把
 *    输入监听挂上，紧接着写进去的按键会直接落空（`app.test.tsx:30` 记过这个坑）。
 *    我第一版就栽在这里 —— 哨兵根本没进状态，"不含密钥"于是**空过**。
 * 2. **必须有一组对照（`secret=false` 收得到哨兵）**：只断言"不含"在"根本没输入"时
 *    也成立。对照组证明输入路径真的生效，上一条才有意义。
 */

import { describe, expect, it } from 'vitest';

import { ChoiceDialog } from '../src/components/ChoiceDialog.js';
import { mountTree } from './mount.js';

const t = (k: string): string => k;
const noColor = (): string | undefined => undefined;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

/** 一个"看起来就是密钥"的哨兵串：它出现在画面上就等于泄漏。 */
const SENTINEL = 'sk-live-sentinel-9f3a';

function mount(props: { secret?: boolean; defaultValue?: string }) {
  const answers: unknown[] = [];
  const r = mountTree(
    <ChoiceDialog
      kind="text"
      title="API Key（输入时不显示）"
      options={[]}
      defaultValue={props.defaultValue ?? ''}
      secret={props.secret}
      t={t}
      color={noColor}
      onAnswer={(a) => answers.push(a)}
    />,
  );
  return { ...r, answers };
}

describe('ChoiceDialog：凭据不回显（H-34a）', () => {
  it('对照组：secret=false 时哨兵**确实**被打进画面（证明输入路径生效）', async () => {
    const { stdin, lastFrame, unmount } = mount({ secret: false });
    await tick();
    stdin.write(SENTINEL);
    await tick();
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).toContain(SENTINEL);
  });

  it('★ secret=true 时，同一个哨兵一个字都不出现在画面上', async () => {
    const { stdin, lastFrame, unmount } = mount({ secret: true });
    await tick();
    stdin.write(SENTINEL);
    await tick();
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).not.toContain(SENTINEL);
    expect(frame).not.toContain('sentinel');
    // 不是"什么都不画"：掩码要在，用户才知道输入被收到了
    expect(frame).toContain('•');
  });

  it('★ secret=true 时不预填默认值（预填本身就是一次回显）', async () => {
    const { lastFrame, unmount } = mount({ secret: true, defaultValue: 'sk-preset-leak' });
    await tick();
    const frame = lastFrame() ?? '';
    unmount();
    expect(frame).not.toContain('sk-preset-leak');
  });

  it('secret=true 时答案仍原样回传（遮的是显示，不是数据）', async () => {
    const { stdin, answers, unmount } = mount({ secret: true });
    await tick();
    stdin.write(SENTINEL);
    await tick();
    stdin.write('\r');
    await tick();
    unmount();
    expect(answers).toEqual([{ text: SENTINEL }]);
  });
});
