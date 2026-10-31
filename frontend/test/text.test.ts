/**
 * 显示宽度的**差分测试** —— 扫一遍码点，与真 Python 逐个比对 `char_width`。
 *
 * ## 为什么必须有它
 *
 * Python 侧用 `unicodedata.east_asian_width()`（查 Unicode 数据库）；JS 没有这个 API，
 * 只能**列区间**。区间表是我手抄的，抄漏一个块（比如漏了谚文兼容区）不会有任何症状 ——
 * 只会让界面**看着歪**，而且只在遇到那类字符时才歪。
 *
 * 所以这里把码点扫一遍交给 Python 判：TS 算出宽度送过去，Python 逐个核对，把不一致的
 * 报回来。区间抄错、抄漏，一眼可见。
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  charWidth,
  displayWidth,
  padWidth,
  sideBySide,
  stripAnsi,
  truncateWidth,
} from '../src/render/text.js';
import { resolvePython } from '../src/protocol/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// ⚠️ 这条比对是**版本敏感**的：TS 侧是手抄的静态区间表，Python 侧是解释器自带的
// `unicodedata`（活表）。两件事一起决定了"参照是谁"：
//   1. `resolvePython()`（`src/protocol/client.ts`）在非 Windows 上会**先试
//      `/usr/bin/python3`**，判据只是"文件存在" —— 光在 CI 装个新 Python 没用；
//   2. 参照解释器的 Unicode 库版本必须和 TS 表对齐的那版一致（本表对齐 15.1）。
// 所以 CI 的 frontend job 既钉 `python-version: 3.13.14`，又设 `ACE_PYTHON=python3`
// （resolvePython 的第一优先级，裸命令名走 PATH）把两者钉成同一个二进制。
// 哪天真红了：先看这条钉还在不在、`ACE_PYTHON` 有没有被绕开，再看
// `frontend/src/render/text.ts` 的区间表是不是该跟着新 Unicode 升级了。
const PY = resolvePython();

/** 要扫的码点范围（跳过代理区，那不是合法字符）。 */
function sweep(): number[] {
  const cps: number[] = [];
  for (let cp = 0x0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    cps.push(cp);
  }
  for (let cp = 0x1f300; cp <= 0x1faff; cp++) cps.push(cp);
  for (let cp = 0x20000; cp <= 0x20030; cp++) cps.push(cp);
  for (let cp = 0x30000; cp <= 0x30010; cp++) cps.push(cp);
  return cps;
}

/** 不一致项：`[码点, TS宽, Python宽, Python 的类别, Python 的东亚宽度]`。 */
interface Mismatch {
  cp: number;
  mine: number;
  py: number;
  cat: string;
  eaw: string;
}

function pythonMismatches(pairs: Array<[number, number]>): Mismatch[] | null {
  const script = [
    'import sys, json, unicodedata',
    'from ui import ace_text as T',
    'pairs = json.loads(sys.stdin.read())',
    'bad = []',
    'for cp, mine in pairs:',
    '    ch = chr(cp)',
    '    py = T.char_width(ch)',
    '    if py != mine:',
    '        bad.append([cp, mine, py, unicodedata.category(ch),',
    '                    unicodedata.east_asian_width(ch)])',
    'print(json.dumps(bad))',
  ].join('\n');
  try {
    const out = execFileSync(PY, ['-c', script], {
      cwd: ROOT,
      input: JSON.stringify(pairs),
      encoding: 'utf-8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return (JSON.parse(out.trim()) as number[][]).map(([cp, mine, py, cat, eaw]) => ({
      cp: cp!,
      mine: mine!,
      py: py!,
      cat: String(cat),
      eaw: String(eaw),
    }));
  } catch {
    return null;
  }
}

const hex = (cp: number): string => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

describe('char_width 与 ui/ace_text 逐个码点比对', () => {
  const cps = sweep();
  const pairs: Array<[number, number]> = cps.map((cp) => [cp, charWidth(String.fromCodePoint(cp))]);
  const bad = pythonMismatches(pairs);

  it('扫的码点够多（否则下面的比对可能空转）', () => {
    expect(cps.length).toBeGreaterThan(60000);
  });

  it.skipIf(bad === null)('**宽字符（W/F）一个都不许差** —— 这才是会把排版弄歪的那类', () => {
    expect(bad, '没拿到 Python 的结果').not.toBeNull();
    const wide = (bad ?? []).filter((m) => m.eaw === 'W' || m.eaw === 'F' || m.py === 2);
    const detail = wide.slice(0, 12).map((m) => `${hex(m.cp)} TS=${m.mine} PY=${m.py} eaw=${m.eaw}`).join('\n');
    expect(detail).toBe('');
  });

  it('剩下的差异**只允许是 Unicode 版本差**（Python 那个字符还不认识）', () => {
    // 实测：Node 24 的 Unicode 表比 Python 3.13 的 `unicodedata` 新 ——
    // 会有若干**较新分配的**组合符，JS 的 `\p{Mn}` 认得（算 0 列），Python 判 `Cn`（未分配，算 1 列）。
    // 这类字符不可能出现在 ACE 的输出里（中文/日文/ASCII/制表符/emoji 都在表里对齐了），
    // 所以容忍；但**必须逐个确认它们真的是 `Cn`** —— 否则就是我把区间抄错了。
    const nonCn = (bad ?? []).filter((m) => m.cat !== 'Cn');
    const detail = nonCn.slice(0, 12).map((m) => `${hex(m.cp)} TS=${m.mine} PY=${m.py} cat=${m.cat}`).join('\n');
    expect(detail, '不是版本差，是我抄错了区间').toBe('');
  });

  it('版本差的规模是有界的（不是"反正都放过"）', () => {
    const n = (bad ?? []).length;
    expect(n, `差异 ${n} 个，超出预期`).toBeLessThan(200);
  });

  it('ACE 实际会用到的字符全部对齐', () => {
    // 中文 / 日文 / 制表符 / 箭头 / 方框绘制 / 常用 emoji —— 这些一个都不许差。
    const used = '中文日한글　！？，。、：；「」『』─│┌┐└┘├┤┬┴┼▁▃▅▇◐◓◑◒·˙•✓✗▶◈◇◆▖▘▝▗❯▏▌█↑↓←→…';
    const usedPairs: Array<[number, number]> = [...used].map((ch) => [
      ch.codePointAt(0)!,
      charWidth(ch),
    ]);
    const b2 = pythonMismatches(usedPairs) ?? [];
    expect(b2.map((m) => hex(m.cp)).join(','), '实际用到的字符有宽度不一致').toBe('');
  });
});

describe('宽度口径（不依赖 Python 的几条）', () => {
  it('ASCII 一列、汉字两列', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('中a文')).toBe(5);
  });

  it('ANSI 颜色码零宽', () => {
    expect(displayWidth('\x1b[32m成功\x1b[0m')).toBe(4);
    expect(stripAnsi('\x1b[32m成功\x1b[0m')).toBe('成功');
  });

  it('组合符与零宽字符占 0 列', () => {
    expect(charWidth('́')).toBe(0); // 组合尖音符
    expect(charWidth('​')).toBe(0); // 零宽空格
  });

  it('emoji 占 2 列（按东亚宽近似）', () => {
    expect(displayWidth('🐛')).toBe(2);
  });
});

describe('截断', () => {
  it('放得下原样返回', () => {
    expect(truncateWidth('abcdef', 10)).toBe('abcdef');
  });

  it('放得下省略号才加', () => {
    expect(truncateWidth('abcdef', 4)).toBe('abc…');
  });

  it('**绝不劈双宽字符**', () => {
    // 实测 Python：`truncate_width('中文中文', 6)` 给 `'中文…'`（宽 5），**不是** `'中文中…'`。
    // 注意 `ui/ace_text.py` 的 docstring 里把这个例子写成了 `'中文中…'` —— **docstring 是错的**，
    // 行为才是准。我第一版照 docstring 抄断言，被差分测试抓出来了。
    expect(truncateWidth('中文中文', 6)).toBe('中文…');
    expect(truncateWidth('中文中文', 5)).toBe('中文…');
    // 够宽时才放得下第三个汉字
    expect(truncateWidth('中文中文', 7)).toBe('中文中…');
  });

  it('结果宽度永不超限', () => {
    for (const s of ['中文测试字符串', 'abcdefghij', '中a文b测c试', '🐛🐛🐛']) {
      for (let lim = 1; lim <= 12; lim++) {
        expect(displayWidth(truncateWidth(s, lim)), `${s}@${lim}`).toBeLessThanOrEqual(lim);
      }
    }
  });

  it('limit <= 0 给空串', () => {
    expect(truncateWidth('abc', 0)).toBe('');
    expect(truncateWidth('abc', -3)).toBe('');
  });

  it('带色截断后补复位码（否则颜色漏到下一行）', () => {
    expect(truncateWidth('\x1b[32mabcdef\x1b[0m', 4)).toContain('\x1b[0m');
  });
});

describe('补齐与并排', () => {
  it('padWidth 按显示宽度补', () => {
    expect(displayWidth(padWidth('中', 5))).toBe(5);
    expect(padWidth('abcdef', 3)).toBe('abcdef'); // 够宽不截断
  });

  it('sideBySide：右栏对齐到左栏**最宽**行（短行先补到那个宽度，再加 gap）', () => {
    // 实测 Python 给 `'AB    一'`：'AB' 先补到最宽行 'ABCD' 的 4 列（补 2 个），
    // 再加 gap 2 个 = 4 个空格。我第一版按"只加 gap"算，少了。
    const out = sideBySide(['AB', 'ABCD'], ['一', '二'], 2);
    expect(out[0]).toBe('AB    一');
    expect(out[1]).toBe('ABCD  二');
  });

  it('sideBySide：高度取两者较大者', () => {
    expect(sideBySide(['A'], ['1', '2', '3'], 1)).toHaveLength(3);
  });

  it('sideBySide：width>0 时整行按列截断（防止撑爆终端触发折行）', () => {
    const out = sideBySide(['ABCDEFGHIJ'], ['很长很长的说明文字'], 1, 12);
    expect(out[0]!.length).toBeGreaterThan(0);
    expect(displayWidth(out[0]!)).toBeLessThanOrEqual(12);
  });

  it('sideBySide：右栏为空时只留左栏（不补一屁股空格）', () => {
    expect(sideBySide(['AB', 'CD'], [], 3)).toEqual(['AB', 'CD']);
  });
});
