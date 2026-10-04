/**
 * 状态字形**三方对拍**：前端工具卡的表 = 设计系统的 `statusIcon` = Python 的 `status_mark`。
 *
 * 为什么值得单开一条：这三处各自维护过一张"状态 → 字形"的表，而漂移的代价很安静 ——
 * 同一个工具在一个外壳里是 `✓`、在另一个外壳里可能变成别的，没人会立刻发现。
 * 这条测试把它们拴在一起（起真 Python 取那边的值来比）。
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { statusIcon } from '../src/components/design-system/index.js';
import { TOOL_GLYPHS } from '../src/components/ToolCard.js';
import { phaseMark } from '../src/components/Spinner.js';
import { resolvePython } from '../src/protocol/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function pythonMarks(): Record<string, string> {
  const code = `
import json, sys
sys.path.insert(0, r"${ROOT}")
from ui.ace_cards import status_mark
print(json.dumps({s: status_mark(s)[0] for s in ["SUCCESS", "pending", "403", "500"]}))
`;
  return JSON.parse(execFileSync(resolvePython(), ['-c', code], { encoding: 'utf-8' }));
}

describe('状态字形三方对拍', () => {
  const py = pythonMarks();

  it('工具卡的表 == 设计系统 == Python 的 status_mark', () => {
    expect(TOOL_GLYPHS.ok).toBe(py.SUCCESS);
    expect(TOOL_GLYPHS.running).toBe(py.pending);
    expect(TOOL_GLYPHS.fail).toBe(py['403']);
    expect(statusIcon('ok')[0]).toBe(py.SUCCESS);
    expect(statusIcon('running')[0]).toBe(py.pending);
    expect(statusIcon('fail')[0]).toBe(py['403']);
    expect(statusIcon('warning')[0]).toBe(py['500']);
  });

  it('每个字形都在设计系统的六态表里（没有"野"字形）', () => {
    const known = new Set(['✓', '✗', '⚠', 'ℹ', '○', '◌']);
    for (const glyph of Object.values(TOOL_GLYPHS)) expect(known.has(glyph)).toBe(true);
  });
});

describe('思考标记 ∴', () => {
  it('只有 reasoning 阶段带标记（工具参数、纯等待不装成"在想"）', () => {
    expect(phaseMark('reasoning')).toContain('∴');
    for (const other of ['waiting', 'tool_args', 'answering', undefined, '']) {
      expect(phaseMark(other)).toBe('');
    }
  });
});
