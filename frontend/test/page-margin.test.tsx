/**
 * 版式几何的断言 —— 「内容内缩」与「结构线出血」（`components/layout/PageMargin.tsx`）。
 *
 * 为什么盯这几条而不是截图：换内核之后**唯一可靠的视觉证据**是
 * `helpers/screen.ts` 的 `renderLines()` —— 它给的是 cell 网格里逐格拼出来的纯文本，
 * 宽度是网格自带的（宽字符占 2 格），不是数出来的。于是"内容行宽 = 终端宽 - 两侧内缩"
 * 这句话可以被断言，而不是靠肉眼看。
 *
 * 借鉴对象的对照：上游 v0.12.0 `components/PageMargin.js` 的两层机制 ——
 * ①根盒 padding 缩进；②**覆盖 `TerminalSizeContext`**，让内层拿到的就是内容区尺寸。
 * 第 ② 条正是"内层组件不需要各自知道边距"的关键，所以这里用 `useColumns()` 探针盯住它。
 */

import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Transcript } from '../src/components/Transcript.js';
import {
  PAGE_INSET,
  PageMargin,
  Rule,
  contentColumns,
  usePageInset,
} from '../src/components/layout/PageMargin.js';
import { useColumns } from '../src/components/design-system/index.js';
import { displayWidth } from '../src/render/text.js';
import type { Item } from '../src/state/store.js';
import { Text } from '../vendor/dsh-ink/kernel.js';
import { renderLines } from './helpers/screen.js';

const noColor = (): string | undefined => undefined;
const t = (k: string): string => k;

/** 内层探针：`useColumns()` 读到的列数 + 内缩量（两者都必须来自 PageMargin）。 */
function Probe(): ReactElement {
  return <Text>{`cols=${useColumns()} inset=${usePageInset().x}`}</Text>;
}

/** 比任何测试宽度都长的一行（中文按 2 列）—— 不带内缩时它会正好顶到最右边。 */
const LONG =
  '把这段长转录在终端里排一下，看看右边会不会贴死边框；内缩两列之后折行位置应该提前两格才对，'
  + '而且每一行都要停在内容列里，不许越过页边距去蹭边框或者滚动条。';

const user = (id: number, text: string): Item => ({ kind: 'user', id, text });

const WIDTHS = [60, 80, 100, 120];

describe('内容内缩：内层拿到的就是内容区尺寸', () => {
  for (const w of WIDTHS) {
    it(`${w} 列：内层读到 ${w - 2 * PAGE_INSET.x} 列，且左右各缩 ${PAGE_INSET.x} 格`, () => {
      const out = renderLines(
        <PageMargin width={w}>
          <Probe />
        </PageMargin>,
        w,
      );
      expect(out.text.trim()).toBe(`cols=${contentColumns(w)} inset=${PAGE_INSET.x}`);
      // 行首缩进是真的画出来了（不是只改了 context）。上下各 1 行的页边距会多出空行，
      // 所以取第一条**有字**的行。
      const first = out.lines.find((l) => l.trim().length > 0)!;
      expect(first).toBe(' '.repeat(PAGE_INSET.x) + `cols=${contentColumns(w)} inset=${PAGE_INSET.x}`);
    });
  }

  it('没有 PageMargin 时是恒等：`usePageInset()` 为 0，组件宽度不变（测试/preview 那条路）', () => {
    const out = renderLines(<Probe />, 80);
    expect(out.text.trim()).toBe('cols=80 inset=0');
  });
});

describe('★不变量：内容行宽 = 终端宽 - 两侧内缩', () => {
  for (const w of WIDTHS) {
    it(`${w} 列：长行在内容列宽处折行（内缩 ${PAGE_INSET.x} + 内容 ${contentColumns(w)}）`, () => {
      const out = renderLines(
        <PageMargin width={w}>
          <Transcript items={[user(1, LONG)]} t={t} color={noColor} />
        </PageMargin>,
        w,
      );
      const body = out.lines.filter((l) => l.trim().length > 0);
      // 上限：正文不许越过内容列（越过就会被终端边框/滚动条切掉）
      for (const line of body) {
        expect(displayWidth(line)).toBeLessThanOrEqual(contentColumns(w) + PAGE_INSET.x);
      }
      // 并且**确实填满**了内容列（只断言"没超"的话，缩进写错成 0 也会绿）
      expect(Math.max(...body.map(displayWidth))).toBe(contentColumns(w) + PAGE_INSET.x);
      // 每一行都从内缩量之后起笔
      for (const line of body) expect(line.startsWith(' '.repeat(PAGE_INSET.x))).toBe(true);
    });
  }
});

describe('结构线：版面级出血，转录内部的线不出血', () => {
  for (const w of WIDTHS) {
    it(`${w} 列：版面级 Rule 从第 0 列画到最后一列（出血量 = 两侧内缩）`, () => {
      const out = renderLines(
        <PageMargin width={w}>
          <Rule color={noColor} />
        </PageMargin>,
        w,
      );
      const line = out.lines.find((l) => l.includes('-'))!;
      expect(displayWidth(line)).toBe(w); // 直通终端左右边缘
      expect(line[0]).toBe('-'); // 不缩进 = 真的出血了
      expect(out.lines.filter((l) => l.trim().length > 0)).toHaveLength(1);
    });
  }

  it('没有 PageMargin 时 Rule 是普通整宽线（出血量 0，负 margin 不生效也无所谓）', () => {
    const out = renderLines(<Rule color={noColor} />, 40);
    const line = out.lines.find((l) => l.includes('-'))!;
    expect(displayWidth(line)).toBe(40);
    expect(line[0]).toBe('-');
  });

  it('转录里的轮次线**留在内容宽**（右边可能还有滚动条，不能压过去）', () => {
    const items = [user(1, '第一轮'), user(2, '第二轮')];
    const out = renderLines(
      <PageMargin width={80}>
        <Transcript items={items} t={t} color={noColor} />
      </PageMargin>,
      80,
    );
    const rules = out.lines.filter((l) => l.trim().length > 0 && l.trim().split('').every((c) => c === '-'));
    expect(rules).toHaveLength(1); // 只有轮次边界那一条
    expect(displayWidth(rules[0]!)).toBe(contentColumns(80) + PAGE_INSET.x); // 78 < 80：没出血
  });

  it('第一条用户消息上面**不画**线（上面没有"上一轮"，线是悬空的）', () => {
    const out = renderLines(
      <PageMargin width={80}>
        <Transcript items={[user(1, '只有一条')]} t={t} color={noColor} />
      </PageMargin>,
      80,
    );
    expect(out.lines.some((l) => l.includes('---'))).toBe(false);
    expect(out.text).toContain('只有一条');
  });
});
