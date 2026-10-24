/**
 * **迁移门禁**：迁入的 dsh-TUI UI 树在**我们仓库里**能渲染，而且画面里的数据是**我们的**。
 *
 * 为什么这条测试重要：那棵树（`frontend/dsh-ui/`，671 个文件）不做 tsc 门禁 ——
 * 只 vendor 了类型子集，追平第三方类型等式没价值（见 `dsh-ui/MIGRATION.md`）。
 * 于是"它到底还能不能跑"必须由**别的东西**守住，否则它会在没人看的时候烂掉。
 * 这条就是那个东西：跑无头 smoke，断言帧里有 ace 的值。
 *
 * 为什么断言这些字符串：
 *   · `deepseek-v4-flash` / `readonly` —— 来自我们的 `AceSnapshot`（模型、权限档）；
 *   · 工作目录 —— 我们从 ace 传进去的 cwd；
 *   · `会话与工作区` —— **上游状态机**（`resolveLaunchpadActions`）产出的动作条目，
 *     说明"用它们的逻辑 + 我们的状态"这条线是通的；
 *   · `HooH v` / `✦ HooH` —— 品牌（我们改的那几处）没被上游文本盖掉。
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function smoke(): string {
  return execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
     join(ROOT, 'dsh-ui', 'hooh', 'smoke.tsx')],
    { cwd: ROOT, encoding: 'utf-8', timeout: 120_000 },
  );
}

describe('★迁入的 dsh-TUI UI：在我们仓库里渲染，数据是我们的', () => {
  const out = smoke();

  it('画出了首屏（不是 error boundary）', () => {
    expect(out).toContain('迁入的 Launchpad 渲染结果');
    expect(out).not.toContain('ERROR  stdin');       // 第一版缺 addListener 就是这条
    expect(out.split('\n').length).toBeGreaterThan(20);
  });

  it('模型 / 权限 / 工作目录来自 ace 的 AceSnapshot', () => {
    expect(out).toContain('deepseek-v4-flash');
    expect(out).toContain('readonly');
    expect(out).toContain('G:\\AI_Project\\ace');
  });

  it('动作表是**上游的状态机**产出、喂的是我们的状态', () => {
    // `resolveLaunchpadActions` 只在"有上一条会话标题"时才给这一条
    expect(out).toContain('继续「');
    expect(out).toContain('会话与工作区');
  });

  it('品牌是 HooH（我们改的三处没被上游文本盖掉）', () => {
    // 右下角版本铭牌：上游打的是 `dsh-tui v…`
    expect(out).toContain('HooH v1.1.0');
    expect(out).not.toContain('dsh-tui v');
    // 角标（`✦ …`）在 chrome=minimal 的布局下不画，所以只钉"没有旧品牌"这一半；
    // 大字标题走的是块字字形（不是文本），断言不了字符串 —— 它的正确性由
    // `splashFonts.ts` 里那两个常量保证（改错了一眼能看出来）。
    expect(out).not.toContain('✦ dsh-TUI');
  });
});

describe('★真入口（`ace ui` 跑的那个）能装、能画', () => {
  it('首屏 → 转录页都画得出来（走子进程：见 MIGRATION.md 的 tsc 边界）', () => {
    const out = execFileSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
       join(ROOT, 'dsh-ui', 'hooh', 'smoke-entry.tsx')],
      { cwd: ROOT, encoding: 'utf-8', timeout: 180_000 },
    );
    expect(out).toContain('① 首屏');
    expect(out).toContain('说点什么');            // 输入框提示 = 首屏画出来了
    expect(out).toContain('② 转录页');            // 接上引擎后的那一页
    expect(out).toContain('首屏画了: true');
    expect(out).not.toContain('ERROR');
  });
});
