/**
 * HelpOverlay（帮助总览屏）验收 —— 全帧级证据，不许 skip：
 *
 *   ① 注册表每条 action（组合键 + 说明）都上屏；
 *   ② 每个组合键的展示串**恰好出现一次**（同一组合键不许在两段里重复出）；
 *   ③ ↑↓ 翻页：窗口随选中项走，原来看不见的命令按 ↓ 后能看见；
 *   ④ 每行显示宽度 ≤ 列宽（80 与 58 两档）；
 *   ⑤ Esc 与 q 都能关。
 *
 * 交互一律用 test/mount.tsx 的 mountTree（假 stdio、有 fd；ink-testing-library 已废）。
 */
import { describe, expect, it } from 'vitest';

import { HelpOverlay, HELP_KEYS, HELP_LOCALES } from '../src/components/help/index.js';
import { I18n } from '../src/i18n.js';
import { KEY_ACTIONS, RESERVED_BINDINGS, comboDisplay, effectiveComboDisplay } from '../src/keys/registry.js';
import { displayWidth } from '../src/render/text.js';
import { renderLines } from './helpers/screen.js';
import { mountTree, waitFor } from './mount.js';

const i18n = new I18n('zh');
const t = (k: string, p?: Record<string, string | number>): string => i18n.t(k, p);

// 30 条命令 × 2 个分组：保证命令列溢出、必须翻页才能看全。
function makeMenu(n = 30) {
  const commands: Record<string, string> = {};
  const groups: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const name = `c${String(i).padStart(2, '0')}`;
    commands[name] = i === 0 ? 'cmd_help' : 'cmd_config';
    groups[name] = i < n / 2 ? 'group_session' : 'group_model';
  }
  return { commands, groups };
}

const noColor = (): string | undefined => undefined;

describe('HelpOverlay', () => {
  it('①注册表每条 action 的组合键与说明都上屏；保留键与分组标题也在', () => {
    const s = renderLines(
      <HelpOverlay t={t} menu={makeMenu(4)} height={40} width={100} onClose={() => {}} />,
      100,
    );
    for (const sp of KEY_ACTIONS) {
      expect(s.text).toContain(effectiveComboDisplay(sp.id));
      expect(s.text).toContain(i18n.t(sp.i18nKey));
    }
    for (const b of RESERVED_BINDINGS) expect(s.text).toContain(comboDisplay(b.combo));
    expect(s.text).toContain(HELP_LOCALES.zh[HELP_KEYS.title]);
    expect(s.text).toContain(HELP_LOCALES.zh[HELP_KEYS.colReserved]);
    // 分组标题（会话 / 模型）插进了命令列
    expect(s.text).toContain(i18n.t('group_session'));
    expect(s.text).toContain(i18n.t('group_model'));
    expect(s.text).toContain('/c00');
    // 选中行的 ❯ 标记可见
    expect(s.text).toContain('❯');
  });

  it('②同一组合键的展示串整屏恰好出现一次', () => {
    const s = renderLines(
      <HelpOverlay t={t} menu={makeMenu(4)} height={40} width={120} onClose={() => {}} />,
      120,
    );
    const seen = new Set<string>();
    for (const raw of [
      ...KEY_ACTIONS.map((sp) => effectiveComboDisplay(sp.id)),
      ...RESERVED_BINDINGS.map((b) => comboDisplay(b.combo)),
    ]) {
      // 同一组合键在两段里重复出现的话，这里会抓到计数 > 1
      // （数字边界：'Ctrl+L' 不能吃掉 'Ctrl+Left' 的前缀）
      const count = s.text
        .split(new RegExp(`(?<![+A-Za-z])${raw.replace(/[+]/g, '\\+')}(?![A-Za-z])`))
        .length - 1;
      expect({ combo: raw, count }).toEqual({ combo: raw, count: 1 });
      expect(seen.has(raw)).toBe(false);
      seen.add(raw);
    }
  });

  it('③↑↓ 翻页：窗口跟着选中项往下走，原来看不见的命令按 ↓ 后露出来', async () => {
    const menu = makeMenu(30);
    const tree = mountTree(
      <HelpOverlay t={t} menu={menu} height={14} width={100} onClose={() => {}} color={noColor} />,
      { width: 100 },
    );
    await waitFor(() => (tree.lastFrame() ?? '').includes('/c00'));
    expect(tree.lastFrame() ?? '').not.toContain('/c29');
    for (let i = 0; i < 25; i++) tree.stdin.write('[B'); // ↓ ×25
    await waitFor(() => (tree.lastFrame() ?? '').includes('/c25'));
    tree.stdin.write('[6~'); // PgDn
    await waitFor(() => (tree.lastFrame() ?? '').includes('/c29'));
    tree.unmount();
  });

  it('④每行显示宽度 ≤ 列宽（80 与 58 两档，中文不许劈半）', () => {
    for (const w of [80, 58]) {
      const s = renderLines(
        <HelpOverlay t={t} menu={makeMenu(6)} height={30} width={w} onClose={() => {}} />,
        w,
      );
      for (const line of s.lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });

  it('⑤Esc 能关；q 也能关', async () => {
    for (const key of ['', 'q']) {
      let closed = 0;
      const tree = mountTree(
        <HelpOverlay t={t} menu={makeMenu(4)} height={20} width={90} onClose={() => { closed += 1; }} />,
        { width: 90 },
      );
      tree.stdin.write(key);
      await waitFor(() => closed === 1);
      expect(closed).toBe(1);
      tree.unmount();
    }
  });

  it('组件三语表键全：HELP_KEYS 每个键 zh/en/ja 都有值', () => {
    const zh = Object.keys(HELP_LOCALES.zh).sort();
    expect(Object.keys(HELP_LOCALES.en).sort()).toEqual(zh);
    expect(Object.keys(HELP_LOCALES.ja).sort()).toEqual(zh);
    for (const v of Object.values(HELP_KEYS)) {
      const key = v as keyof (typeof HELP_LOCALES)['zh'];
      for (const lang of ['zh', 'en', 'ja'] as const) {
        expect(HELP_LOCALES[lang][key]).toBeTruthy();
      }
    }
  });

  it('帧证据：一屏里同时看得见快捷键行、命令分组标题和选中标记', () => {
    const s = renderLines(
      <HelpOverlay t={t} menu={makeMenu(6)} height={26} width={80} onClose={() => {}} />,
      80,
    );
    // eslint-disable-next-line no-console
    console.log(`\n${s.lines.map((l) => `|${l}`).join('\n')}`);
    expect(s.lineWith('Ctrl+T')).toBeTruthy();
    expect(s.lineWith(i18n.t('group_session'))).toBeTruthy();
    expect(s.lineWith('❯')).toBeTruthy();
  });
});
