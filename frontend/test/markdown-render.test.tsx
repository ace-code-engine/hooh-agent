/**
 * `Markdown` 的**表格渲染**测试 —— 补一道此前不存在的防线。
 *
 * 为什么单开一条：`markdown.test.ts` 只测解析（纯函数）。这个仓库踩过一次
 * "模型算得对、组件画出来却是错的"，所以表格这种**靠列对齐才成立**的东西
 * 必须真的渲染出来看一眼 —— 列宽算错在纯函数里是看不出来的。
 *
 * ## 迁移记录（S5，换内核）
 * `ink-testing-library` 的 `render()` / `lastFrame()` → `./helpers/screen.js` 的 `renderLines()`
 * （内核 `renderToScreen`：同步、纯 buffer、不写 stdout，字符从 cell 网格取）。
 * 两条改动，**断言一个字没改**：
 *   1. 宽度只能由调用方给：`renderLines(tree, 100)`，与组件自己的 `width={100}` 对齐
 *      —— 老的 100 列来自假 stdout 的 `columns`，换工具后这条**顺便变显式**了；
 *   2. 不再 `await tick()`：`renderToScreen` 返回时帧已经画完（原来那 30ms 是在赌 Ink 的异步 flush）。
 * 反向断言（"正文里的竖线不被画成表格框"）在纯文本上比在带 ANSI 的帧上更强。
 */

import { describe, expect, it } from 'vitest';

import { Markdown } from '../src/components/Markdown.js';
import { parseMarkdown } from '../src/render/markdown.js';
import { displayWidth } from '../src/render/text.js';
import { renderLines } from './helpers/screen.js';

const noColor = (): string | undefined => undefined;

describe('表格渲染', () => {
  it('画出列边框与表头分隔线，且各行**显示宽度一致**（中文占两列也算对）', () => {
    const blocks = parseMarkdown('| 名 | 值 |\n|:--|--:|\n| 甲 | 1 |\n| 乙 | 22 |');
    const out = renderLines(<Markdown blocks={blocks} color={noColor} width={100} />, 100).text;
    expect(out).toContain('│');
    expect(out).toContain('├');
    expect(out).toContain('甲');
    // 对齐的判据是**显示宽度**，不是码点数：`甲` 占 2 列、`1` 占 1 列
    // （带 `│` 的是表头 + 数据行；分隔线用的是 `├┼┤`，不算在内）
    const rows = out.split('\n').filter((l) => l.includes('│'));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((l) => displayWidth(l))).size).toBe(1);
  });

  it('正文里的竖线不会被画成表格框', () => {
    const blocks = parseMarkdown('a | b 只是一行普通文本');
    const out = renderLines(<Markdown blocks={blocks} color={noColor} width={100} />, 100).text;
    expect(out).not.toContain('├');
  });
});
