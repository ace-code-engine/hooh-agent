/**
 * i18n 完整性守卫 —— **中/英/日必须成套**（这条不是"最好有"，是硬要求）。
 *
 * 三条判据：
 *   1. 三份字典的**键集合完全相同**（少一个键，那种语言下就会露出键名）；
 *   2. 代码里 `t('key')` 引用的**每一个键**在三份字典里都存在；
 *   3. 组件源码里**不许有硬编码的中文字面量**（注释除外）——
 *      界面文案漏进代码，就等于那种语言下永远显示中文。
 *
 * 第 3 条是这次补的：审计发现错误边界那两句中文直接写死在 JSX 里，三语字典再全也救不了。
 *
 * **边界**：界面文案必须三语；**内部异常文本**（`throw new Error('...')` 给维护者看的那种）
 * 一律用英文 —— 它们不是"界面语言"，翻译反而让人以为那是给用户的话。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 组件侧「键常量表」—— 第 2 条守卫**看不见**这一类键（它只认 `t('字面量')`）。
// 导入真正的表（不是在这里抄一份），表改了这条守卫就跟着改，不会漂。
import { DRAFT_KEYS } from '../src/components/draft-editor/DraftEditor.js';
import { PICKER_KEYS } from '../src/components/pickers/Picker.js';
import { PANEL_KEYS } from '../src/components/settings/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANGS = ['zh', 'en', 'ja'] as const;

const dicts = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'locales', `${l}.json`), 'utf-8')) as Record<string, string>]),
) as Record<(typeof LANGS)[number], Record<string, string>>;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const srcFiles = walk(join(ROOT, 'frontend', 'src'));

/** 去掉注释：行注释、块注释、JSX 注释 —— 注释里的中文不算"硬编码文案"。 */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 取一组源码里 `t('key')` / `t("key")` 的字面量键（注释先剥掉）。 */
function literalKeysIn(files: string[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf-8'));
    for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) out.add(m[1]!);
  }
  return [...out];
}

/**
 * 有键常量表的组件 —— `table` 只用于报错，`keys` 是**真表**（导入或从源码取）。
 * session-tree 没有常量表（键就是 `t('stree_*')` 字面量），所以从它的源码取，不另抄一份。
 */
const KEY_TABLES: Array<{ table: string; keys: readonly string[] }> = [
  { table: 'DRAFT_KEYS（draft-editor/DraftEditor.tsx）', keys: Object.values(DRAFT_KEYS) },
  { table: 'PICKER_KEYS（pickers/Picker.tsx）', keys: Object.values(PICKER_KEYS) },
  { table: 'PANEL_KEYS（settings/schema.ts）', keys: Object.values(PANEL_KEYS) },
  {
    table: "session-tree 的 t('stree_*')（session-tree/）",
    keys: literalKeysIn(walk(join(ROOT, 'frontend', 'src', 'components', 'session-tree'))),
  },
];

describe('i18n 完整性（中/英/日成套）', () => {
  it('三份字典的键集合完全相同', () => {
    const zh = Object.keys(dicts.zh).sort();
    expect(Object.keys(dicts.en).sort()).toEqual(zh);
    expect(Object.keys(dicts.ja).sort()).toEqual(zh);
  });

  it('代码里引用的每个 `t(\'key\')` 三语都有', () => {
    const missing: string[] = [];
    const used = new Set<string>();
    for (const file of srcFiles) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]!);
      for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]!);
    }
    for (const key of used) {
      // 以 `_` 结尾的是**拼出来的前缀**（如 `t('x_' + kind)`）：要求它至少能拼出某个真键
      if (key.endsWith('_')) {
        if (!Object.keys(dicts.zh).some((k) => k.startsWith(key))) missing.push(`${key}*`);
        continue;
      }
      for (const lang of LANGS) {
        if (!(key in dicts[lang])) missing.push(`${key}@${lang}`);
      }
    }
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(20);      // 守卫本身要真的扫到东西（前端直引 30+ 个键）
  });

  it('组件源码里没有硬编码的中文字面量（注释除外）', () => {
    const cjk = /[\u4e00-\u9fff]/;
    const hits: string[] = [];
    for (const file of srcFiles) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/'([^'\n]{2,})'|"([^"\n]{2,})"/g)) {
          const lit = m[1] ?? m[2] ?? '';
          if (cjk.test(lit)) hits.push(`${file.replace(ROOT, '')}:${i + 1} ${lit.slice(0, 30)}`);
        }
      });
    }
    // 允许清单：**必须为空**才是理想状态；留这个变量是为了让例外显式可见、有理由
    const allowed: string[] = [];
    expect(hits.filter((h) => !allowed.some((a) => h.includes(a)))).toEqual([]);
  });

  /**
   * 常量表里的键 —— 第 2 条守卫**看不见**的那一类。
   *
   * 组件把键写进常量表（`DRAFT_KEYS` / `PANEL_KEYS` / `PICKER_KEYS`）后，源码里就没有
   * `t('字面量')` 了：「表里有、字典里没有」不会有任何测试报错，只有运行时露出键名。
   * 这条把表导入进来，逐个键对三份字典点一遍，失败信息带表名（缺哪个键、在哪张表里）。
   */
  it('常量表里的每个键，三语字典里都有值且非空', () => {
    const bad: string[] = [];
    for (const { table, keys } of KEY_TABLES) {
      // 表被扫空 = 守卫在假绿（改名/挪走了却没跟上）
      if (keys.length === 0) bad.push(`表是空的：${table}`);
      for (const key of [...new Set(keys)].sort()) {
        for (const lang of LANGS) {
          const value = dicts[lang][key];
          if (value === undefined) bad.push(`缺键 ${key}（${lang} 里没有）—— 在 ${table}`);
          else if (value.trim() === '') bad.push(`空值 ${key}（${lang} 是空串）—— 在 ${table}`);
        }
      }
    }
    expect(bad).toEqual([]);
    // 守卫本身要真的扫到东西
    expect(KEY_TABLES.reduce((n, t) => n + t.keys.length, 0)).toBeGreaterThan(20);
  });

  /**
   * 新表不许绕过上一条：源码里每个 `export const *_KEYS = {...}` 都必须在 `KEY_TABLES` 里登记。
   * 没登记的表 = 又一次那个洞（表里的键没人查）。
   */
  it('源码里的 `*_KEYS` 常量表都已登记进 KEY_TABLES', () => {
    const declared = new Set<string>();
    for (const file of srcFiles) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      for (const m of src.matchAll(/export const ([A-Za-z0-9_]*KEYS)\s*[=:]/g)) declared.add(m[1]!);
    }
    expect([...declared].sort()).toEqual(['DRAFT_KEYS', 'PANEL_KEYS', 'PICKER_KEYS']);
  });
});
