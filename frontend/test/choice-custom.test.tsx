/**
 * P-10："让用户自己输入选项" —— `choose` 里**命中 0 项却按回车 = 提交自填值**。
 *
 * 为什么此前做不了：`ChoiceDialog` 的 `choose` 分支在回车时 `picked = filtered[sel]`，
 * 而 `filtered` 为空时 `picked` 是 `undefined` → 什么都不发生。于是用户键入一个列表里
 * 没有的值、按回车，答案被**静默吞掉**（`ROADMAP` §3.3 根因 ① 的外壳侧病灶）。
 *
 * 对照组同样重要：命中 ≥1 项时仍应选**列表里的值**，别把正常挑选也改成"回显键入串"。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` 整体失效（假 stdout 没有 `fd`、且写死 import 上游 ink 的 React 18
 * 渲染器，collect 期就炸）→ 改用 `./mount.js`（内核 `renderSync` + 假 stdio，见该文件头）。
 * 断言一字未改，`await tick()` 保留（按键要等内核把重渲染冲刷出来）。
 */

import { describe, expect, it } from 'vitest';

import { ChoiceDialog } from '../src/components/ChoiceDialog.js';
import { mountTree } from './mount.js';

const t = (k: string): string => k;
const noColor = (): string | undefined => undefined;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('ChoiceDialog：choose 命中 0 项却回车 = 提交自填值（P-10）', () => {
  it('★命中 0 项 + 回车 → 把键入的串原样回传（不再静默吞掉）', async () => {
    const answers: unknown[] = [];
    const { stdin, unmount } = mountTree(
      <ChoiceDialog
        kind="choose"
        title="选模型"
        options={['deepseek', 'qwen']}
        defaultValue=""
        t={t}
        color={noColor}
        onAnswer={(a) => answers.push(a)}
      />,
    );
    await tick();
    stdin.write('custom-model-x');
    await tick();
    stdin.write('\r');
    await tick();
    unmount();
    expect(answers).toEqual([{ values: ['custom-model-x'] }]);
  });

  it('对照组：命中 ≥1 项时仍选中**列表里的值**（不误伤正常挑选）', async () => {
    const answers: unknown[] = [];
    const { stdin, unmount } = mountTree(
      <ChoiceDialog
        kind="choose"
        title="选模型"
        options={['deepseek', 'qwen']}
        defaultValue=""
        t={t}
        color={noColor}
        onAnswer={(a) => answers.push(a)}
      />,
    );
    await tick();
    stdin.write('\r');   // 无过滤，选中第一项
    await tick();
    unmount();
    expect(answers).toEqual([{ values: ['deepseek'] }]);
  });
});
