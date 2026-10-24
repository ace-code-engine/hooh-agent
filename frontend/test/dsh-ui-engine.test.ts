/**
 * **端到端门禁（第 ③ 步的验收）**：真引擎 → 我们的词典 → 上游投影器 → 上游组件。
 *
 * 与 `dsh-ui-smoke.test.ts` 的分工：那条守"迁入的 UI 画得出来"（喂静态快照）；
 * 这条守**接线**——引擎真起进程、真跑一轮、事件真的变成画面上的字。
 *
 * 为什么必须自动化：这条链上有四个会各自悄悄坏掉的地方 —— 引擎协议改了、
 * 事件名的对应改了、上游的投影器改了、消息组件改了。任何一处坏了，界面上
 * 就是"没反应"，而单元测试全绿。
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(): string {
  return execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
     join(ROOT, 'dsh-ui', 'hooh', 'smoke-chat.tsx')],
    {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 180_000,
      // 引擎用离线 mock：这条测的是**接线**，不是模型质量
      env: { ...process.env, ACE_MOCK: '1' },
    },
  );
}

describe('★端到端：ace 引擎 → 迁入的 UI', () => {
  const out = run();

  it('引擎真起了进程、真出了事件（不是空跑）', () => {
    const m = out.match(/引擎事件 (\d+) 条 → DSH 事件 (\d+) 条/);
    expect(m, '没看到事件计数行').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(5);
    expect(Number(m![2])).toBeGreaterThanOrEqual(2);
  });

  it('我们的提问进了转录（`user/message` 那条映射是通的）', () => {
    expect(out).toContain('用一句话说明这个工作区是干什么的');
  });

  it('引擎的回答被上游组件画出来了（`final` → `assistant/message` → 画面上有字）', () => {
    // mock 剧本回的是时间戳一类的话；只钉"画面上有一条 assistant 输出"
    expect(out).toMatch(/●\s+\S/);
    expect(out).not.toContain('ERROR');
  });
});

describe('★常驻界面（首屏 → 聊天页，接真引擎）', () => {
  it('跑完一轮后转录里有我的提问、工具卡、引擎的回答', () => {
    const out = execFileSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
       join(ROOT, 'dsh-ui', 'hooh', 'smoke-app.tsx')],
      { cwd: ROOT, encoding: 'utf-8', timeout: 180_000 },
    );
    expect(out).toContain('有我的提问: true');
    expect(out).toContain('有引擎回答: true');
    // 工具卡：`rowsFromEvents` 把 `tool_call` 折成上游的 `ToolRow`（`• 名字(...)`）
    expect(out).toMatch(/•\s+\S+\(/);
    expect(out).not.toContain('ERROR');
  });
});
