/**
 * `Markdown` 的**表格渲染**测试 —— 补一道此前不存在的防线。
 *
 * 为什么单开一条：`markdown.test.ts` 只测解析（纯函数）。这个仓库踩过一次
 * "模型算得对、组件画出来却是错的"，所以表格这种**靠列对齐才成立**的东西
 * 必须真的渲染出来看一眼 —— 列宽算错在纯函数里是看不出来的。
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../src/components/Markdown.js';
import { parseMarkdown } from '../src/render/markdown.js';
import { displayWidth } from '../src/render/text.js';

const noColor = (): string | undefined => undefined;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('表格渲染', () => {
  it('画出列边框与表头分隔线，且各行**显示宽度一致**（中文占两列也算对）', async () => {
    const blocks = parseMarkdown('| 名 | 值 |\n|:--|--:|\n| 甲 | 1 |\n| 乙 | 22 |');
    const { lastFrame } = render(<Markdown blocks={blocks} color={noColor} />);
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('│');
    expect(out).toContain('├');
    expect(out).toContain('甲');
    // 对齐的判据是**显示宽度**，不是码点数：`甲` 占 2 列、`1` 占 1 列
    // （带 `│` 的是表头 + 数据行；分隔线用的是 `├┼┤`，不算在内）
    const rows = out.split('\n').filter((l) => l.includes('│'));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((l) => displayWidth(l))).size).toBe(1);
  });

  it('正文里的竖线不会被画成表格框', async () => {
    const blocks = parseMarkdown('a | b 只是一行普通文本');
    const { lastFrame } = render(<Markdown blocks={blocks} color={noColor} />);
    await tick();
    expect(lastFrame() ?? '').not.toContain('├');
  });
});
