/**
 * 键位注册表测试 —— 六条验收逐条断言：默认键位查询 / 平台别名 / `exactPrimary` /
 * 保留键被拒（且**信息可读**）/ 冲突能指出双方 / 未知 action 的行为。
 *
 * 为什么这里可以"照抄源码再核对"：这一层没有第二实现可比对（Python 侧的
 * `ui/ace_keys.py` 是另一套模型：prompt_toolkit 键名、和弦、作用域），要比的是
 * **行为**不是数值，所以直接拿 `ink` 形状的 `Key` 标志喂进去断言。
 * 平台别名一律用 `{ platformAlias }` 注入两种极性 —— 否则这套断言在 CI 上
 * 会跟着 `process.platform` 变，等于没测。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  KEY_ACTIONS,
  RESERVED_BINDINGS,
  actionSpec,
  canonicalComboString,
  comboDisplay,
  defaultPlatformAlias,
  effectiveCombos,
  effectiveComboDisplay,
  findConflicts,
  isReserved,
  matchesAction,
  matchesActionStrict,
  parseCombo,
  reservedBinding,
  resetKeyOverrides,
  setKeyOverrides,
  validateRebind,
} from '../src/keys/registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCALES = ['zh', 'en', 'ja'] as const;

afterEach(() => resetKeyOverrides());

describe('① 默认键位查询', () => {
  it('每个 action 都能查到声明、默认键与展示形式', () => {
    expect(actionSpec('tasks')?.defaults).toEqual(['ctrl+t']);
    expect(effectiveCombos('tasks').map((combo) => combo.raw)).toEqual(['ctrl+t']);
    expect(effectiveComboDisplay('tasks')).toBe('Ctrl+T');
    expect(actionSpec('toggle_thinking')?.defaults).toEqual(['alt+k']);
    expect(actionSpec('undo')?.defaults).toEqual(['ctrl+z']);
  });

  it('配置里从来没写过的 action 只是查不到，不抛', () => {
    expect(actionSpec('nope')).toBeUndefined();
    expect(effectiveCombos('nope')).toEqual([]);
    expect(effectiveComboDisplay('nope')).toBe('');
  });

  it('默认表内部零冲突（有冲突说明默认键抄错了）', () => {
    expect(findConflicts()).toEqual([]);
  });

  it('每个 action 的 i18n 键三语字典里都存在（发键不发译文）', () => {
    const dicts = LOCALES.map(
      (lang) => JSON.parse(readFileSync(join(ROOT, 'locales', `${lang}.json`), 'utf-8')) as Record<string, string>,
    );
    for (const spec of KEY_ACTIONS) {
      for (const dict of dicts) {
        expect(Object.keys(dict), `${spec.id} 的 ${spec.i18nKey} 缺一种语言`).toContain(spec.i18nKey);
      }
    }
  });

  it('保留集引用的 i18n 键要么已存在，要么是报告里列出的建议键', () => {
    // Python 侧 `APP_KEYMAP` 引用了 4 个不存在的键（key_del_word/key_del_line/
    // key_word_left/key_word_right）——前端有 i18n 守卫，所以这里必须显式钉住。
    const proposed = new Set([
      'key_del_line',
      'key_del_word',
      'key_word_left',
      'key_word_right',
      'key_line_start',
      'key_line_end',
    ]);
    const zh = JSON.parse(readFileSync(join(ROOT, 'locales', 'zh.json'), 'utf-8')) as Record<string, string>;
    for (const entry of RESERVED_BINDINGS) {
      if (proposed.has(entry.i18nKey)) continue;
      expect(Object.keys(zh), `保留键 ${entry.combo} 的 i18n 键 ${entry.i18nKey} 不存在`).toContain(entry.i18nKey);
    }
  });
});

describe('② 平台别名（ctrl ↔ Cmd）', () => {
  it('mac 上 ctrl+t 也认 Cmd+T', () => {
    expect(matchesAction('tasks', 't', { ctrl: true }, { platformAlias: false })).toBe(true);
    expect(matchesAction('tasks', 't', { super: true }, { platformAlias: true })).toBe(true);
  });

  it('非 mac 上 Win 键不认（别名是平台相关的一条规则，不是恒真）', () => {
    expect(matchesAction('tasks', 't', { super: true }, { platformAlias: false })).toBe(false);
  });

  it('alt 走 ink 的 meta 标志，不是 super', () => {
    expect(matchesAction('model_pick', 'm', { meta: true }, { platformAlias: false })).toBe(true);
    expect(matchesAction('model_pick', 'm', { super: true }, { platformAlias: true })).toBe(false);
  });

  it('shift 永远精确：ctrl+shift+t 不许命中 ctrl+t', () => {
    expect(matchesAction('tasks', 't', { ctrl: true, shift: true }, { platformAlias: false })).toBe(false);
  });

  it('没命中就是没命中（字符与修饰键分别要对）', () => {
    expect(matchesAction('tasks', 'y', { ctrl: true }, { platformAlias: false })).toBe(false);
    expect(matchesAction('tasks', 't', {}, { platformAlias: false })).toBe(false);
  });

  it('默认别名跟随平台（本机跑什么平台都不该抛）', () => {
    expect(typeof defaultPlatformAlias()).toBe('boolean');
  });
});

describe('③ exactPrimary：这个动作不套别名', () => {
  it('undo 只认真 Ctrl+Z', () => {
    expect(matchesAction('undo', 'z', { ctrl: true }, { platformAlias: false })).toBe(true);
    expect(matchesAction('undo', 'z', { super: true }, { platformAlias: true })).toBe(false);
  });

  it('对照组：其它动作在 mac 上照样吃 Cmd', () => {
    expect(matchesAction('tasks', 't', { super: true }, { platformAlias: true })).toBe(true);
  });

  it('严格匹配（自定义键位通道）连普通动作也不认 Cmd', () => {
    expect(matchesActionStrict('tasks', 't', { ctrl: true })).toBe(true);
    expect(matchesActionStrict('tasks', 't', { super: true })).toBe(false);
  });
});

describe('④ 保留键：当场拒绝，并且说得出原因', () => {
  it('ctrl+c 是保命键，查得出它保护的是哪个动作', () => {
    expect(reservedBinding('ctrl+c')?.action).toBe('interrupt');
    expect(reservedBinding('ctrl+c')?.reason).toBe('lifeline');
    expect(isReserved('CTRL+C')).toBe(true);
  });

  it('语法上不是"快捷键"的裸键也在保留集里（tab/escape/shift+tab）', () => {
    expect(parseCombo('tab')).toBeUndefined(); // 裸键本来就解析不了
    expect(isReserved('tab')).toBe(true);
    expect(isReserved('escape')).toBe(true);
    expect(isReserved('shift+tab')).toBe(true);
  });

  it('mac 写法 cmd+c 归一成 ctrl+c，不许绕过保留集', () => {
    expect(canonicalComboString('cmd+c')).toBe('ctrl+c');
    expect(isReserved('cmd+c')).toBe(true);
    expect(validateRebind('tasks', 'cmd+c').ok).toBe(false);
  });

  it('拒绝信息可读：报出键位、动作、类别与 i18n 键', () => {
    const result = validateRebind('tasks', 'ctrl+c');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('reserved');
    expect(result.combo).toBe('ctrl+c');
    expect(result.message).toContain('ctrl+c'); // 原样回显用户写的键
    expect(result.message).toContain('reserved'); // 说清"为什么不行"
    expect(result.message).toContain('interrupt'); // 说清"这是谁的键"
    expect(result.i18nKey).toBe('keys_err_reserved');
    expect(result.params).toMatchObject({ combo: 'Ctrl+C', action: 'interrupt', reason: 'lifeline' });
    expect(result.reserved?.reason).toBe('lifeline');
  });

  it('tab 这类裸键收到的是"保命键"，不是"写法不合法"', () => {
    const result = validateRebind('tasks', 'tab');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('reserved');
    expect(result.message).toContain('reserved');
  });

  it('写法错误另有说法（可读，且和保留集分得开）', () => {
    const doubled = validateRebind('tasks', 'ctrl+ctrl+k');
    expect(doubled.ok).toBe(false);
    if (!doubled.ok) {
      expect(doubled.code).toBe('malformed');
      expect(doubled.message).toContain('ctrl+ctrl+k');
      expect(doubled.i18nKey).toBe('keys_err_malformed');
    }
    const bogus = validateRebind('tasks', 'foobar');
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) expect(bogus.code).toBe('malformed');
  });

  it('被拒之后状态真的没动', () => {
    setKeyOverrides({ tasks: 'ctrl+c' });
    expect(effectiveCombos('tasks').map((combo) => combo.raw)).toEqual(['ctrl+t']);
  });

  it('批量覆盖里坏的那条被拒绝、好的那条照样生效（不是静默丢）', () => {
    const out = setKeyOverrides({ tasks: 'ctrl+c', find: 'alt+f' });
    expect(out.applied).toEqual(['find']);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]!.code).toBe('reserved');
    expect(effectiveCombos('find').map((combo) => combo.raw)).toEqual(['alt+f']);
    expect(effectiveCombos('tasks').map((combo) => combo.raw)).toEqual(['ctrl+t']);
  });
});

describe('⑤ 冲突检测：能指出双方', () => {
  it('抢别人的键 → 报出对方名字', () => {
    const result = validateRebind('tasks', 'ctrl+o');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('conflict');
    expect(result.conflictsWith).toEqual(['expand']);
    expect(result.message).toContain('ctrl+o');
    expect(result.message).toContain('expand'); // 双方都在信息里
    expect(result.message).toContain('tasks');
    expect(result.i18nKey).toBe('keys_err_conflict');
  });

  it('把键写回自己不算冲突（否则连默认值都存不回去）', () => {
    expect(validateRebind('expand', 'ctrl+o').ok).toBe(true);
    expect(validateRebind('tasks', 'ctrl+t').ok).toBe(true);
  });

  it('多键草稿里任一键撞车就整条拒', () => {
    const result = validateRebind('tasks', 'ctrl+y, alt+k');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflictsWith).toEqual(['toggle_thinking']);
  });

  it('诊断接口能把既成冲突的双方都列出来', () => {
    const conflicts = findConflicts({ tasks: 'ctrl+o' });
    expect(conflicts).toEqual([{ combo: 'ctrl+o', actions: ['tasks', 'expand'] }]);
  });

  it('空草稿 = 撤销覆盖回到默认（不是错误）', () => {
    setKeyOverrides({ tasks: 'ctrl+y' });
    expect(effectiveCombos('tasks').map((combo) => combo.raw)).toEqual(['ctrl+y']);
    const cleared = validateRebind('tasks', '  ');
    expect(cleared).toEqual({ ok: true, action: 'tasks', combos: [] });
    setKeyOverrides({ tasks: '' });
    expect(effectiveCombos('tasks').map((combo) => combo.raw)).toEqual(['ctrl+t']);
  });
});

describe('⑥ 未知 action 的查询行为', () => {
  it('查声明 / 查键位 / 匹配 / 重映射：一律有确定结果，不抛', () => {
    expect(actionSpec('nope')).toBeUndefined();
    expect(effectiveCombos('nope')).toEqual([]);
    expect(matchesAction('nope', 'k', { ctrl: true })).toBe(false);

    const result = validateRebind('nope', 'ctrl+y');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unknown_action');
    expect(result.message).toContain('nope');
    expect(result.i18nKey).toBe('keys_err_unknown_action');
  });

  it('批量覆盖里的未知动作进 rejected，不静默吞掉', () => {
    const out = setKeyOverrides({ 'not-an-action': 'ctrl+y' });
    expect(out.applied).toEqual([]);
    expect(out.rejected.map((entry) => entry.code)).toEqual(['unknown_action']);
  });
});

describe('展示与规范化（提示文案跟着重映射走的前提）', () => {
  it('canonical 顺序稳定：修饰键排序 + 键名最后', () => {
    expect(canonicalComboString('shift+ctrl+k')).toBe('ctrl+shift+k');
    expect(canonicalComboString('CMD+c')).toBe('ctrl+c');
    // 命名键的规范形取 ink 的标志名本身（`upArrow`），与借鉴对象一致：它是**内部**去重键，
    // 给用户看的写法走 `comboDisplay(combo.raw)`。
    expect(canonicalComboString('alt+UP')).toBe('alt+upArrow');
    expect(comboDisplay('alt+up')).toBe('Alt+Up');
  });

  it('comboDisplay 只改大小写，不改语义', () => {
    expect(comboDisplay('ctrl+shift+e')).toBe('Ctrl+Shift+E');
    expect(comboDisplay('pgup')).toBe('PgUp');
  });
});
