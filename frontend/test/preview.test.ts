/**
 * `tools/preview.ts` 的守门测试。
 *
 * 为什么一个"给人看的脚本"要有测试：它渲的是真组件，组件改名/改 props 之后它会崩，
 * 而**崩了没人知道** —— 那正是"接手第一件事是拿眼睛看一眼"这件事一直没有判据的原因。
 * 这几条断言只保证它还在跑、每帧有内容、几个关键画面确实出现了；
 * 好不好看仍然只能由人看（`npm run preview`）。
 *
 * ## 迁移记录（S6，换内核）
 * `tools/preview.tsx` 从 `ink-testing-library` 的 `render()` 换成 `test/mount.tsx`
 * 的 `mountTree()`（那个包在 collect 期就抛 `ReactCurrentOwner`，本文件曾 0 用例）。
 * 断言意图一字未改；`--plain` 那条的两处修正见用例内注释。
 */

import chalk from 'chalk';
import { describe, expect, it } from 'vitest';

import { buildPreviewFrames, stripAnsi } from '../tools/preview.js';

describe('npm run preview', () => {
  it('跑完脚本，每一帧都有内容（空白帧 = 脚本或组件坏了）', async () => {
    const frames = await buildPreviewFrames(true);
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.frame.trim().length).toBeGreaterThan(0);
    }
  });

  it('关键画面都在：底栏分段 / 流式增量 / 工具卡片 / 审批框 / 任务树', async () => {
    const frames = await buildPreviewFrames(true);
    const all = frames.map((f) => f.frame).join('\n');
    // 底栏那一段来自引擎的 status 事件（H 系列新接的发射点）
    expect(all).toContain('上下文 12%');
    // 流式增量（model_delta）真的逐拍长出来了
    expect(all).toContain('我先读一下 README');
    // 工具卡片带 diff
    expect(all).toContain('README.md');
    expect(all).toContain('HooH · 互');
    // 审批框三态
    expect(all).toContain('rm -rf build/');
    // 任务树（Ctrl+T 之后的帧）
    expect(all).toContain('补全菜单');
  });

  it('`--plain` 与带色两版**文字完全一致**（剥色不该动内容）', async () => {
    const plain = await buildPreviewFrames(true);
    const colored = await buildPreviewFrames(false);
    // 同一把尺子（`tools/preview.tsx` 导出的那个），别在这里再实现一遍。
    expect(plain.map((f) => f.frame)).toEqual(colored.map((f) => stripAnsi(f.frame)));
    // 更强的一条：`--plain` 的帧里**一个 ESC 都不许剩**。只查 `\u001b[` 会漏掉
    // OSC 超链接（内核发的是 BEL 收尾的 `\x1b]8;;\x07`）—— 那个残留正是这条用例
    // 换成内核后红过的原因。
    for (const f of plain) expect(f.frame).not.toMatch(/\u001b/);
    // 反过来也要成立：带色那版**确实**有控制序列。否则"两版一致"是废话（都空）。
    expect(colored.some((f) => /\u001b/.test(f.frame))).toBe(true);
  });

  it('颜色由 chalk 决定 —— 非 TTY 下没有 ANSI，这是**环境**不是脚本坏了', () => {
    // 记一笔：`tools/preview.tsx` 走 `mountTree()` 的假 stdout，它**不是 TTY**，
    // chalk 于是把颜色关掉，所以 CI 里拿到的帧是**无色的**（排版照旧可验，配色不行）。
    // 要真的看配色，在启动 node **之前**设 FORCE_COLOR（chalk 在 import 时就定级了）：
    //     PowerShell:  $env:FORCE_COLOR=1; npm run preview
    //     bash:        FORCE_COLOR=1 npm run preview
    // 这一条只断言"两版文字一致"（上一用例），不假装能验颜色。
    expect(chalk.level).toBeTypeOf('number');
  });
});
