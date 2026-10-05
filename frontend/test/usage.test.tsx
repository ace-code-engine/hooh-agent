/**
 * usage 组件族自测 —— ContextBar 不变量 / UsageTable 对齐 / BalanceCard 空态 / i18n 成套。
 *
 * 渲染一律走 `renderLines`（vendored 内核的 cell 屏，宽度是网格自带的）。
 * **宽度断言用 `displayWidth`，不用 `.length`**（CJK 会被数成一半）。
 */

import { describe, expect, it } from 'vitest';

import {
  BalanceCard, ContextBar, UsageTable, USAGE_KEYS, USAGE_LOCALES, fmtTokens, makeUsageT, normalizeRows,
} from '../src/components/usage/index.js';
import { displayWidth } from '../src/render/text.js';
import { renderLines } from './helpers/screen.js';

const tZh = makeUsageT('zh');
const PARTIAL = /[▏▎▍▌▋▊▉]/;
const BAR_CHARS = /^[▏▎▍▌▋▊▉█─]*$/;

describe('usage/i18n —— 三语成套（接管 i18n-complete 看不到的那一摊）', () => {
  it('每个键 zh/en/ja 都有非空值，键集合与 USAGE_KEYS 全等', () => {
    const keys = Object.values(USAGE_KEYS).sort();
    expect(Object.keys(USAGE_LOCALES).sort()).toEqual(keys);
    for (const k of keys) {
      for (const lang of ['zh', 'en', 'ja'] as const) {
        expect(USAGE_LOCALES[k as keyof typeof USAGE_LOCALES]?.[lang], `${k}@${lang}`).toBeTruthy();
      }
    }
  });
  it('键前缀 usage_*，不与既有前缀相撞', () => {
    for (const k of Object.values(USAGE_KEYS)) expect(k.startsWith('usage_')).toBe(true);
  });
  it('缺键露出键名（与全局 I18n 同口径）', () => {
    expect(tZh('usage_nope')).toBe('usage_nope');
  });
});

describe('ContextBar 不变量', () => {
  it('行宽恒等于给定 width（读数在/不在两种形态都算）', () => {
    for (const w of [12, 16, 20, 30, 47, 80]) {
      for (const used of [0, 1, 50, 100, 101, 200]) {
        const s = renderLines(<ContextBar used={used} total={100} t={tZh} width={w} />, w);
        expect(displayWidth(s.lines[0] ?? ''), `w=${w} used=${used}: ${s.lines[0]}`).toBe(w);
      }
    }
  });
  it('阶段边界不混格：filled 为整数时只有 █ 和 ─，任意比例下只有八分之一块字符', () => {
    const W = 16; // 窄到读数放不下 → 整行都是 bar
    for (let used = 0; used <= 128; used++) {
      const s = renderLines(<ContextBar used={used} total={128} t={tZh} width={W} />, W);
      const bar = s.lines[0] ?? '';
      expect(bar, `used=${used}`).toMatch(BAR_CHARS);
      if (((used / 128) * W) % 1 === 0) expect(bar, `used=${used} 踩边界`).not.toMatch(PARTIAL);
    }
  });
  it('超界钳位：used > total 与负数都钳回 [0,total]，不编出负百分比', () => {
    const over = renderLines(<ContextBar used={999} total={100} t={tZh} width={12} />, 12);
    expect(over.lines[0]).toBe('█'.repeat(12));
    const under = renderLines(<ContextBar used={-5} total={100} t={tZh} width={12} />, 12);
    expect(under.lines[0]).toBe('─'.repeat(12));
  });
  it('无数据 → 明确空态文案，行里一个没有据可查的数字都不出现', () => {
    for (const [used, total] of [[undefined, 100], [10, undefined], [10, 0], [Number.NaN, 100]] as const) {
      const s = renderLines(<ContextBar used={used} total={total} t={tZh} width={80} />, 80);
      expect(s.text).toContain(tZh(USAGE_KEYS.ctxEmpty).trim());
    }
  });
});

describe('UsageTable 对齐', () => {
  const rows = normalizeRows([
    { label: 'kimi-k3', input: 128000, output: 4500 },
    { label: '备用模型甲乙丙丁', input: 7, output: 999 },
  ]);
  it('每行显示宽度等于表宽；数字列右对齐、跨行同列同宽（含中文行名）', () => {
    for (const w of [30, 44, 80]) {
      const s = renderLines(<UsageTable rows={rows} t={tZh} width={w} />, w);
      expect(s.lines.length).toBe(3);
      for (const line of s.lines) expect(displayWidth(line), line).toBe(w);
      // 末列右顶到行尾：行尾字符是数字（表头是表头文字）
      for (let i = 1; i < s.lines.length; i++) expect(s.lines[i]!.slice(-1)).toMatch(/[0-9kM]/);
    }
  });
  it('长行名按显示宽度截断，数字列绝不让位（含 CJK 行名不劈半字）', () => {
    const w = 30;
    const s = renderLines(<UsageTable rows={rows} t={tZh} width={w} />, w);
    expect(displayWidth(s.lines[1]!)).toBe(w);
    // 各行的输入数字块右边缘同列
    const colEnd = (l: string, token: string) => displayWidth(l.slice(0, l.indexOf(token) + token.length));
    const a = colEnd(s.lines[1]!, '128k');
    const b = colEnd(s.lines[2]!, '7');
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1); // 1 位是 CJK 截断的半格余量
  });
  it('空/脏数据 → 一行明确空态，不把坏行编成 0', () => {
    expect(normalizeRows('junk')).toEqual([]);
    expect(normalizeRows([{ label: '', input: 1, output: 2 }, { label: 'ok', input: 1, output: 2 }])).toEqual([
      { label: 'ok', input: 1, output: 2 },
    ]);
    const s = renderLines(<UsageTable rows={[]} t={tZh} width={80} />, 80);
    expect(s.text).toContain(tZh(USAGE_KEYS.tblEmpty).trim());
  });
  it('fmtTokens 短读数分档', () => {
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(4500)).toBe('4.5k');
    expect(fmtTokens(128000)).toBe('128k');
    expect(fmtTokens(2500000)).toBe('2.5M');
  });
});

describe('BalanceCard', () => {
  it('未接入：无数据/空数组都显式"未接入"，一个数字不编', () => {
    for (const balances of [undefined, null, []] as const) {
      const s = renderLines(<BalanceCard balances={balances} t={tZh} width={40} />, 40);
      expect(s.text).toContain(tZh(USAGE_KEYS.balEmpty).trim());
      expect(s.text).not.toMatch(/\d/);
    }
  });
  it('有数据：逐币种画；缺 granted/toppedUp 就只画币种与总额', () => {
    const s = renderLines(
      <BalanceCard
        balances={[{ currency: 'CNY', total: 12.3, granted: 10, toppedUp: 2.3 }, { currency: 'USD', total: 1 }]}
        t={tZh}
        width={50}
      />,
      50,
    );
    expect(s.text).toContain('CNY 12.30');
    expect(s.text).toContain('10.00');
    expect(s.lineWith('USD')?.trim()).toBe('USD 1.00'); // 缺字段就只画币种与总额，不补 0
  });
});
