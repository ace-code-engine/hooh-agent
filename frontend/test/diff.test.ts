/**
 * diff 渲染测试 —— 每条口径都与 `ui/ace_diff.py` 对齐。
 *
 * 为什么值得较真：diff 统计错了不会报错，只会**安静地显示错误的数字** ——
 * 而用户拿它判断"这次改动大不大"。最典型的一处是文件头：`+++`/`---` 若计入增删，
 * 每个 diff 都变成"删一行、加一行"。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_DIFF_LINES,
  colorName,
  colorizeDiff,
  diffMarker,
  diffSlot,
  looksLikeDiff,
  splitByFile,
  statText,
  summarizeDiff,
} from '../src/render/diff.js';
import { ToolCard } from '../src/components/ToolCard.js';
import { h, renderLines } from './helpers/screen.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SAMPLE = [
  '--- a/note.md',
  '+++ b/note.md',
  '@@ -1,3 +1,4 @@',
  ' 第一行',
  '-旧的第二行',
  '+新的第二行',
  '+新增的第三行',
  ' 第四行',
].join('\n');

describe('与 ui/ace_diff.py 的口径一致', () => {
  it('MAX_DIFF_LINES 相同', () => {
    const src = readFileSync(join(ROOT, 'ui', 'ace_diff.py'), 'utf-8');
    const m = src.match(/MAX_DIFF_LINES\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MAX_DIFF_LINES);
  });

  it('looks_like_diff 的判据相同：要 `@@` 或 `---`/`+++` 成对', () => {
    // 三条边界，与 .py 里的实现一一对应
    expect(looksLikeDiff('@@ -1 +1 @@')).toBe(true);
    expect(looksLikeDiff('--- a/x\n+++ b/x')).toBe(true);
    expect(looksLikeDiff('--- a/x')).toBe(false); // 只有一半 → 不算
    expect(looksLikeDiff('+ 只是个加号开头')).toBe(false);
  });
});

describe('统计', () => {
  it('**文件头不计入增删**（否则每个 diff 都"删一行加一行"）', () => {
    const s = summarizeDiff(SAMPLE);
    expect(s.added).toBe(2);
    expect(s.removed).toBe(1);
  });

  it('`@@` 块头不计入', () => {
    expect(summarizeDiff('@@ -1,3 +1,4 @@\n+甲').added).toBe(1);
  });

  it('文件列表**不去 `a/`/`b/` 前缀** —— 与 `summarize_diff` 一致（去前缀的是 `split_by_file`）', () => {
    // 实测 Python：summarize_diff 给 ['a/note.md','b/note.md']，split_by_file 给 ['note.md']。
    // 两边分工不同：这里是"统计用"，两级视图那边才需要人看的干净路径。
    expect(summarizeDiff(SAMPLE).files).toEqual(['a/note.md', 'b/note.md']);
    expect(splitByFile(SAMPLE).map((f) => f.path)).toEqual(['note.md']);
  });

  it('`/dev/null` 不进文件列表（删除文件时它就是那个名字）', () => {
    const s = summarizeDiff('--- a/gone.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-内容');
    expect(s.files).not.toContain('/dev/null');
    expect(s.files).toEqual(['a/gone.md']);
  });

  it('stat_text：一行 `+N -M`，无改动给空串', () => {
    expect(statText(SAMPLE)).toBe('+2 -1');
    expect(statText('@@ -1 +1 @@\n 没变')).toBe('');
  });
});

describe('上色', () => {
  it('加绿 / 减红 / 块头青 / 其余 dim', () => {
    expect(colorName('+新增')).toBe('success');
    expect(colorName('-删除')).toBe('error');
    expect(colorName('@@ -1 +1 @@')).toBe('info');
    expect(colorName(' 上下文')).toBe('dim');
  });

  it('**文件头按 dim 而非红绿** —— 它们不是"删了这行、加了那行"', () => {
    expect(colorName('--- a/x')).toBe('dim');
    expect(colorName('+++ b/x')).toBe('dim');
  });

  it('diff_marker：不是 diff 行给 `?`', () => {
    expect(diffMarker('+x')).toBe('+');
    expect(diffMarker('-x')).toBe('-');
    expect(diffMarker('@@')).toBe('@');
    expect(diffMarker(' x')).toBe(' ');
    expect(diffMarker('普通文本')).toBe('?');
    expect(diffMarker('')).toBe('?');
  });
});

describe('渲染与截断', () => {
  it('空输入给空列表', () => {
    expect(colorizeDiff('')).toEqual([]);
  });

  it('超上限时截断并**如实说明还有多少行**（不冒充完整）', () => {
    const long = Array.from({ length: MAX_DIFF_LINES + 7 }, (_, i) => `+第${i}行`).join('\n');
    const out = colorizeDiff(long);
    expect(out).toHaveLength(MAX_DIFF_LINES + 1);
    expect(out[out.length - 1]!.text).toContain('7');
  });

  it('不超上限时不加说明行', () => {
    expect(colorizeDiff('+甲\n-乙')).toHaveLength(2);
  });
});

describe('按文件切开（两级视图）', () => {
  it('两个文件各成一段，路径与增删都对', () => {
    const two = [
      'diff --git a/one.md b/one.md',
      '--- a/one.md',
      '+++ b/one.md',
      '@@ -1 +1 @@',
      '-旧',
      '+新',
      'diff --git a/two.md b/two.md',
      '--- a/two.md',
      '+++ b/two.md',
      '@@ -1 +1,2 @@',
      '+只加',
    ].join('\n');
    const files = splitByFile(two);
    expect(files.map((f) => f.path)).toEqual(['one.md', 'two.md']);
    expect(files[0]).toMatchObject({ added: 1, removed: 1 });
    expect(files[1]).toMatchObject({ added: 1, removed: 0 });
  });

  it('每个文件的 hunk 数与块内增删计数', () => {
    const files = splitByFile(SAMPLE);
    expect(files).toHaveLength(1);
    expect(files[0]!.hunks).toHaveLength(1);
    expect(files[0]!.hunks[0]).toMatchObject({ added: 2, removed: 1 });
  });

  it('**path 剥掉 `a/`/`b/` 前缀**（这里是给人看的，与 summarizeDiff 分工不同）', () => {
    expect(splitByFile(SAMPLE).map((f) => f.path)).toEqual(['note.md']);
  });

  it('空输入返回空数组', () => {
    expect(splitByFile('')).toEqual([]);
  });
});

/**
 * 状态槽 —— 借鉴 dsh-TUI `SplitDiffView`（他们 issue #250）：工具给的 diff **不带文件偏移**，
 * 编一个行号比没有更糟（人会拿它去 `sed -n '<n>p'`）。所以只声明"这行是什么"。
 */
describe('状态槽（替代行号）', () => {
  it('增 / 删 / 上下文 / 块头 / 不是 diff 行 —— 五档分得开', () => {
    expect(diffSlot('+新')).toBe('+');
    expect(diffSlot('-旧')).toBe('-');
    expect(diffSlot(' 上下文')).toBe(' ');
    expect(diffSlot('@@ -1,3 +1,4 @@')).toBe('~');
    // 文件头第一个字符也是 `-`/`+`：不特判就会被谎报成"删了这行、加了这行"
    expect(diffSlot('--- a/x')).toBe('?');
    expect(diffSlot('+++ b/x')).toBe('?');
    expect(diffSlot('diff --git a/x b/x')).toBe('?');
    expect(diffSlot('普通输出')).toBe('?');
    expect(diffSlot('')).toBe('?');
  });

  it('**不变量**：colorizeDiff 每一行都有槽位，且正文里不再重复行首标记', () => {
    const out = colorizeDiff(SAMPLE);
    expect(out).toHaveLength(8);
    for (const l of out) expect(['+', '-', ' ', '~', '?']).toContain(l.slot);
    const body = (slot: string): string[] => out.filter((l) => l.slot === slot).map((l) => l.text);
    expect(body('+')).toEqual(['新的第二行', '新增的第三行']);
    expect(body('-')).toEqual(['旧的第二行']);
    expect(body(' ')).toEqual(['第一行', '第四行']);
    expect(body('~')).toEqual(['@@ -1,3 +1,4 @@']);
    expect(body('?')).toEqual(['--- a/note.md', '+++ b/note.md']);
  });

  it('Tab 展开成 3 空格（否则宽度算式会散架），超限说明行走 `?` 槽位', () => {
    expect(colorizeDiff('+\ta')[0]!.text).toBe('   a');
    const long = Array.from({ length: MAX_DIFF_LINES + 7 }, (_, i) => `+第${i}行`).join('\n');
    const out = colorizeDiff(long);
    expect(out[out.length - 1]).toMatchObject({ slot: '?' });
  });

  it('**渲染层不变量**：工具卡里每一行 diff 都以「槽位 + 空格」开头（第 0 列不是数字）', () => {
    const rows = colorizeDiff(SAMPLE);
    const out = renderLines(
      h(ToolCard, { tool: 'file_edit', target: 'note.md', status: 'ok', diff: SAMPLE, color: () => undefined }),
      80,
    );
    // 卡片把 diff 缩进 2 列，所以行首是 `  <槽位> `
    const drawn = out.lines.filter((l) => /^ {2}[+\-~? ] /.test(l));
    expect(drawn).toHaveLength(rows.length);
    expect(out.has('  ? --- a/note.md')).toBe(true); // 文件头不再冒充删除行
    expect(out.has('  - 旧的第二行')).toBe(true);
    expect(out.has('  + 新的第二行')).toBe(true);
    expect(out.has('  ~ @@ -1,3 +1,4 @@')).toBe(true);
  });
});
