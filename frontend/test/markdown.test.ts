/**
 * Markdown 解析测试。
 *
 * 重点不在"能解析标准 Markdown"，而在**受控子集的边界行为**：模型输出里
 * 未闭合的围栏、混排的列表、嵌套的标记是常态。解析器在这些输入下必须
 * **不丢内容**（宁可当普通段落），因为把用户的话吃掉比排版难看糟得多。
 */

import { describe, expect, it } from 'vitest';

import {
  inOpenFence,
  parseInline,
  parseMarkdown,
  toPlainText,
  type Block,
} from '../src/render/markdown.js';

const kinds = (bs: Block[]): string[] => bs.map((b) => b.kind);

describe('行内标记', () => {
  it('粗体 / 斜体 / 行内码', () => {
    expect(parseInline('**粗**')).toEqual([{ text: '粗', bold: true }]);
    expect(parseInline('*斜*')).toEqual([{ text: '斜', italic: true }]);
    expect(parseInline('`码`')).toEqual([{ text: '码', code: true }]);
  });

  it('混排按出现顺序切分', () => {
    const spans = parseInline('前**粗**中`码`后');
    expect(spans.map((s) => s.text)).toEqual(['前', '粗', '中', '码', '后']);
    expect(spans[1]!.bold).toBe(true);
    expect(spans[3]!.code).toBe(true);
  });

  it('没有标记时原样返回一段', () => {
    expect(parseInline('普通文字')).toEqual([{ text: '普通文字' }]);
  });

  it('未闭合的标记不当标记（留作原文，不吞字符）', () => {
    const spans = parseInline('**没闭合');
    expect(spans.map((s) => s.text).join('')).toBe('**没闭合');
  });

  it('`**` 比 `*` 优先（否则粗体会被解析成两个斜体）', () => {
    const spans = parseInline('**粗**');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.bold).toBe(true);
  });
});

describe('块级结构', () => {
  it('段落', () => {
    expect(kinds(parseMarkdown('第一段'))).toEqual(['paragraph']);
  });

  it('空行分段', () => {
    expect(kinds(parseMarkdown('一\n\n二'))).toEqual(['paragraph', 'paragraph']);
  });

  it('标题分级', () => {
    const bs = parseMarkdown('# 一级\n## 二级\n### 三级');
    expect(kinds(bs)).toEqual(['heading', 'heading', 'heading']);
    expect(bs.map((b) => (b.kind === 'heading' ? b.level : 0))).toEqual([1, 2, 3]);
  });

  it('无序与有序列表', () => {
    const ul = parseMarkdown('- 甲\n- 乙');
    expect(ul).toHaveLength(1);
    expect(ul[0]).toMatchObject({ kind: 'list', ordered: false });
    expect((ul[0] as { items: unknown[] }).items).toHaveLength(2);

    const ol = parseMarkdown('1. 甲\n2. 乙');
    expect(ol[0]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('列表类型切换时另起一块（别混成一个列表）', () => {
    const bs = parseMarkdown('- 甲\n1. 乙');
    expect(kinds(bs)).toEqual(['list', 'list']);
  });

  it('引用', () => {
    const bs = parseMarkdown('> 引用一句');
    expect(bs[0]).toMatchObject({ kind: 'quote' });
  });

  it('分隔线', () => {
    expect(kinds(parseMarkdown('---'))).toEqual(['hr']);
    expect(kinds(parseMarkdown('***'))).toEqual(['hr']);
  });

  it('代码块带语言标注', () => {
    const bs = parseMarkdown('```ts\nconst a = 1;\n```');
    expect(bs[0]).toMatchObject({ kind: 'code', lang: 'ts', lines: ['const a = 1;'] });
  });
});

describe('受控子集的边界行为（真正会咬人的地方）', () => {
  it('**未闭合的围栏按已闭合处理** —— 流式渲染时围栏常是半截的，丢弃会让代码块闪一下没了', () => {
    const bs = parseMarkdown('```py\nprint(1)');
    expect(bs[0]).toMatchObject({ kind: 'code', lines: ['print(1)'] });
  });

  it('代码块**内部**的井号和横线不当结构（否则代码会被拆成一堆标题）', () => {
    const bs = parseMarkdown('```\n# 不是标题\n- 不是列表\n```');
    expect(kinds(bs)).toEqual(['code']);
    expect((bs[0] as { lines: string[] }).lines).toEqual(['# 不是标题', '- 不是列表']);
  });

  it('不认识的行当普通段落文字（**不丢内容**）', () => {
    // 注：`| 表 | 头 |` + 分隔行**现在**是表格（见下面的表格用例）——这里换成一条
    // 真正不受支持的构造（脚注定义），保住这条测试的本意：不认识也要留着。
    const weird = '[^1]: 脚注定义不是受支持的块';
    const bs = parseMarkdown(weird);
    expect(toPlainText(bs)).toContain('[^1]: 脚注定义不是受支持的块');
  });

  it('表格：表头 + 分隔行 + 数据行 → 一个 table 块（分隔行不进数据）', () => {
    const bs = parseMarkdown('| 名 | 值 |\n|---|:--:|\n| 甲 | 1 |\n| 乙 | 2 |');
    expect(kinds(bs)).toEqual(['table']);
    const t = bs[0];
    if (t?.kind !== 'table') throw new Error('不是 table');
    expect(t.rows).toHaveLength(3);
    expect(t.rows.map((r) => r.length)).toEqual([2, 2, 2]);
    expect(toPlainText(bs)).toContain('甲');
  });

  it('表格：**只有竖线不算表**（正文里随手一个 `|` 不该被误判）', () => {
    expect(kinds(parseMarkdown('a | b 只是一行普通文本'))).toEqual(['paragraph']);
    expect(kinds(parseMarkdown('| 只有表头没有分隔行 |'))).toEqual(['paragraph']);
  });

  it('空输入不产出块', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n  ')).toEqual([]);
  });

  it('null / undefined 不崩', () => {
    expect(parseMarkdown(null as unknown as string)).toEqual([]);
    expect(parseMarkdown(undefined as unknown as string)).toEqual([]);
  });
});

describe('流式收尾判定', () => {
  it('未闭合围栏 → true', () => {
    expect(inOpenFence('```\nabc')).toBe(true);
  });

  it('已闭合 → false', () => {
    expect(inOpenFence('```\nabc\n```')).toBe(false);
  });

  it('没有围栏 → false', () => {
    expect(inOpenFence('普通文字')).toBe(false);
  });

  it('两个围栏互相抵消（一开一合）', () => {
    expect(inOpenFence('```\na\n```\n```\nb')).toBe(true);
  });
});

describe('纯文本化', () => {
  it('结构标记被去掉，内容保留（供日志与断言用）', () => {
    const plain = toPlainText(parseMarkdown('# 标题\n\n正文**粗**\n\n- 甲\n- 乙\n\n```\ncode\n```'));
    expect(plain).toContain('标题');
    expect(plain).toContain('正文粗');
    expect(plain).toContain('- 甲');
    expect(plain).toContain('code');
    expect(plain).not.toContain('**');
  });
});
