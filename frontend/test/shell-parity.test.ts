/**
 * 三个"外壳口径"的跨语言对拍 —— WP-0 / W0-A 的 **R-1 / R-3 / R-4**。
 *
 * 为什么需要：这三处此前**没有任何对拍**，于是已经各写各的：
 *
 * 1. **授权三态**：Ink 侧自抄了一份选项表（`PermissionDialog.tsx` 的注释写着"须与
 *    `ui/ace_turn.PERMISSION_OPTIONS` 对齐"），但**没有断言**；而 Python 那一档
 *    `danger=True`（"本会话允许"是一次真实的权力扩张，不该长得像"就这一次"）在 Ink 侧**丢了**。
 * 2. **工具卡状态字形**：三套（Python 卡片 4 态 / 看板 3 态 / Ink 3 态），零对拍。
 * 3. **"成功不展开"的只读工具集**：Ink 侧那份写着 `file_glob` / `file_grep` / `file_search` /
 *    `list_dir` —— **注册表里没有这些工具**；而最吵的 `search` / `terminal_read` 一类
 *    反而不在里面，于是"成功时折叠"这条口径在两个外壳里**行为不同**。
 *
 * 手法与 `theme.test.ts` / `spinner.test.ts` 一致：**直接读 Python 源文件比对**，
 * 不靠文档提醒。每条都先断言"解析成功"，否则解析一坏就会变成"两边都空所以相等"的假绿。
 *
 * ## 迁移记录（S5，换内核）
 * 三条**渲染级**用例（`Menu`，纯渲染无输入）从 `ink-testing-library` 的
 * `render()` / `lastFrame()` 迁到 `./helpers/screen.js` 的 `renderLines()`
 * （内核 `renderToScreen`：同步、纯 buffer、纯文本）。断言一字未改，只去掉了 `await tick()`。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { describe, expect, it } from 'vitest';

import { Menu } from '../src/components/Menu.js';
import { PERMISSION_OPTIONS } from '../src/components/PermissionDialog.js';
import { READ_TOOLS, TOOL_GLYPHS } from '../src/components/ToolCard.js';
import { MENU_GAP, labelColumn, windowBounds, type MenuItem, type MenuState } from '../src/render/menu.js';
import { resolvePython } from '../src/protocol/client.js';
import { renderLines } from './helpers/screen.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = resolvePython();
const readPy = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');
const t = (k: string): string => k;
const noColor = (): string | undefined => undefined;

/** 跑一段 Python（`input` 走 stdin 的 JSON），失败返回 null（没 Python 就跳过对比）。 */
function pythonJson(script: string, payload: unknown): unknown {
  try {
    const out = execFileSync(PY, ['-c', script], {
      cwd: ROOT,
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      timeout: 60_000,
    });
    return JSON.parse(out.trim());
  } catch {
    return null;
  }
}

/** 调真 Python 算一批菜单窗口；失败返回 null（环境没有 Python 就跳过对比）。 */
function pythonWindowBounds(cases: Array<[number, number, number]>): Array<[number, number]> | null {
  const script = [
    'import json, sys',
    'from ui import ace_menu as m',
    'cases = json.loads(sys.stdin.read())',
    'print(json.dumps([list(m.window_bounds(t, s, r)) for t, s, r in cases]))',
  ].join('\n');
  return pythonJson(script, cases) as Array<[number, number]> | null;
}

/**
 * 从 `ui/ace_turn.py` 的 `PERMISSION_OPTIONS` **赋值行**抠出 `(value, key, danger)`。
 *
 * 注意：这个名字第一次出现是在该文件的 **`__all__` 列表里** —— 一开始用
 * `src.split('PERMISSION_OPTIONS')[1]` 取到的是"两次出现之间"那段，**恰好不含声明**，
 * 于是断言在空数组上跑（幸好有下面那条"解析护栏"把它拦下来了）。
 * 这里锚定**行首的赋值**，不靠出现次数。
 */
function pyPermissionOptions(): Array<{ value: string; key: string; danger: boolean }> {
  const src = readPy('ui/ace_turn.py');
  const decl = /^PERMISSION_OPTIONS[^\n]*=[^\n]*\(/m.exec(src);
  const block = decl ? src.slice(decl.index) : '';
  const out: Array<{ value: string; key: string; danger: boolean }> = [];
  const re = /\("(\w+)",\s*"(\w+)",\s*(True|False)\)/g;
  let m: RegExpExecArray | null = re.exec(block);
  while (m !== null && out.length < 4) {
    out.push({ value: m[1]!, key: m[2]!, danger: m[3] === 'True' });
    m = re.exec(block);
  }
  return out;
}

/**
 * `ui/ace_cards.status_mark` 的函数体。
 *
 * 别用 `split('\n\n')` 截 —— `status_mark` 的 **docstring 内部就有空行**，
 * 那样会把函数体切掉、只留 docstring 的第一行（第一版就是这么假红的）。
 * 这里切到**下一个顶层 `def`**。
 */
function statusMarkBody(): string {
  const after = readPy('ui/ace_cards.py').split('def status_mark')[1] ?? '';
  return after.split('\ndef ')[0] ?? after;
}

describe('R-1 授权三态：与 ui/ace_turn.PERMISSION_OPTIONS 一致', () => {
  const py = pyPermissionOptions();

  it('解析护栏：Python 侧确实抠出了三条', () => {
    expect(py).toHaveLength(3);
    expect(py.map((o) => o.value)).toEqual(['once', 'session', 'deny']);
  });

  it('★顺序 / 取值 / i18n 键 / **危险标记**四项全一致', () => {
    expect(PERMISSION_OPTIONS.map((o) => o.decision)).toEqual(py.map((o) => o.value));
    expect(PERMISSION_OPTIONS.map((o) => o.key)).toEqual(py.map((o) => o.key));
    expect(PERMISSION_OPTIONS.map((o) => o.danger)).toEqual(py.map((o) => o.danger));
  });

  it('危险那一档就是 `session`（"本会话允许"= 权力扩张，不是"就这一次"）', () => {
    expect(py.filter((o) => o.danger).map((o) => o.value)).toEqual(['session']);
  });
});

describe('R-3 工具卡状态字形：与 ui/ace_cards.status_mark 一致', () => {
  const body = statusMarkBody();

  it('解析护栏：Python 侧三种标记都取到了', () => {
    expect(/if s == "SUCCESS":\s*\n\s*return "([^"]+)"/.exec(body)?.[1]).toBeTruthy();
    expect(/if s == "PENDING":\s*\n\s*return "([^"]+)"/.exec(body)?.[1]).toBeTruthy();
    expect(/if s in HARD_ERRORS:\s*\n\s*return "([^"]+)"/.exec(body)?.[1]).toBeTruthy();
  });

  it('★同一状态同一个字（ok/running/fail ↔ SUCCESS/PENDING/硬错误）', () => {
    const succ = /if s == "SUCCESS":\s*\n\s*return "([^"]+)"/.exec(body)![1]!;
    const pend = /if s == "PENDING":\s*\n\s*return "([^"]+)"/.exec(body)![1]!;
    const hard = /if s in HARD_ERRORS:\s*\n\s*return "([^"]+)"/.exec(body)![1]!;
    expect(TOOL_GLYPHS.ok).toBe(succ);
    expect(TOOL_GLYPHS.running).toBe(pend);
    expect(TOOL_GLYPHS.fail).toBe(hard);
  });

  it('已知缺口（**记账**，不是通过）：Python 的第四态 `⚠` 在 Ink 侧还没有', () => {
    const warn = /return "([^"]+)", "yellow"/.exec(body)?.[1];
    expect(warn).toBe('⚠');
    // 缺口一旦被补上，这一条会红 —— 那时请连同本文件一起更新（别让它悄悄变成"通过"）
    expect(Object.values(TOOL_GLYPHS)).not.toContain('⚠');
  });
});

describe('R-4 只读工具集（"成功不展开"）与 ui/ace_cards.READ_TOOLS 一致', () => {
  const py = (() => {
    const src = readPy('ui/ace_cards.py');
    const block = src.split('READ_TOOLS = frozenset({')[1]?.split('})')[0] ?? '';
    return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
  })();

  it('解析护栏：Python 侧确实抠出了十多个工具名', () => {
    expect(py.length).toBeGreaterThanOrEqual(10);
  });

  it('★两侧集合完全相同（顺序无关）', () => {
    expect([...READ_TOOLS].sort()).toEqual([...py].sort());
  });

  it('★每个名字都是注册表里**真实存在**的工具（防再写出 file_glob 这种名字）', () => {
    const reg = readPy('tools/registry.py');
    expect(reg).toContain('file_read');       // 解析护栏：注册表确实读到了
    const unknown = [...READ_TOOLS].filter((n) => !reg.includes(`"${n}"`));
    expect(unknown).toEqual([]);
  });
});

/** 窗口策略的对拍用例：`(total, selected, rows)` 全组合（含 0 与边界）。 */
const WIN_CASES: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (const total of [0, 1, 5, 20]) {
    for (const rows of [1, 3, 8]) {
      for (let sel = 0; sel < Math.max(1, total); sel++) out.push([total, sel, rows]);
    }
  }
  return out;
})();

describe('R-5 菜单窗口策略：与 ui/ace_menu.window_bounds 逐例相同', () => {
  const pyWin = pythonWindowBounds(WIN_CASES);

  it('用例表本身非空（防"零用例所以全过"）', () => {
    expect(WIN_CASES.length).toBeGreaterThan(60);
  });

  it.skipIf(pyWin === null)('★同一 (total, selected, rows) ⇒ **同一个可见窗口**', () => {
    expect(pyWin, '没拿到 Python 的窗口').not.toBeNull();
    expect(pyWin!.length).toBe(WIN_CASES.length);
    const bad: string[] = [];
    WIN_CASES.forEach(([total, sel, rows], i) => {
      const w = windowBounds(total, sel, rows);
      const want = pyWin![i]!;
      if (w.from !== want[0] || w.to !== want[1]) {
        bad.push(`(${total},${sel},${rows}) ts=[${w.from},${w.to}) py=[${want[0]},${want[1]})`);
      }
    });
    // 逐例罗列，别只报"第一条不同" —— 策略性差异一次会错一片
    expect(bad).toEqual([]);
  });

  it('策略本身写明了是**黏边**（选中项在窗口内时窗口不动），不是居中', () => {
    // 手动钉住这个取向：`menu.ts` 的注释里必须说清"为什么不居中"
    const src = readPy('frontend/src/render/menu.ts');
    expect(src).toContain('黏');
    expect(windowBounds(20, 10, 3)).toEqual({ from: 8, to: 11, hiddenAbove: 8, hiddenBelow: 9 });
  });
});

describe('R-6 菜单说明列：与 ui/ace_menu 同口径', () => {
  const SETS: string[][] = [
    [],
    ['/help'],
    ['/help', '/model'],
    ['glob', '/very-long-command'],
    ['中文标签', 'ab'],            // 按**显示列**算，不按码点
  ];

  it('本侧规则：窗口内最宽标签 + MENU_GAP（空集也不崩）', () => {
    expect(MENU_GAP).toBe(2);
    expect(labelColumn([])).toBe(2);
    expect(labelColumn(['/help', '/model'])).toBe(8);
    expect(labelColumn(['中文标签', 'ab'])).toBe(10);   // 4 个汉字 = 8 列
  });

  const pyCols = pythonJson([
    'import json, sys',
    'from ui import ace_menu as m',
    'sets = json.loads(sys.stdin.read())',
    'print(json.dumps([m.desc_column(s) for s in sets]))',
  ].join('\n'), SETS) as number[] | null;

  it.skipIf(pyCols === null)('★同一组标签 ⇒ **同一列**（含中文按显示列算）', () => {
    expect(pyCols, '没拿到 Python 的列').not.toBeNull();
    expect(pyCols!.length).toBe(SETS.length);
    SETS.forEach((s, i) => {
      expect(labelColumn(s), `标签集 ${JSON.stringify(s)}`).toBe(pyCols![i]);
    });
  });

  // —— 渲染级：规则有没有**真的被用上**（这才是"对齐"本身）——
  const ITEMS: Array<[string, string]> = [
    ['/help', '说明help'],
    ['/model', '说明model'],
    ['/permissions-x', '说明long'],
  ];
  const pyRows = pythonJson([
    'import json, sys',
    'from ui import ace_menu as m',
    'items = json.loads(sys.stdin.read())',
    'st = m.MenuState([m.MenuItem(l, l, d, "g", "command") for l, d in items], 0, True, "command")',
    'print(json.dumps(m.render_menu(st, 80, max_rows=8, translate=lambda k: k)))',
  ].join('\n'), ITEMS) as string[] | null;

  it.skipIf(pyRows === null)('★**渲染结果**里"说明相对标签的偏移"两侧相同（规则真被用上了）', () => {
    expect(pyRows, '没拿到 Python 的渲染行').not.toBeNull();
    const items: MenuItem[] = ITEMS.map(([label, desc]) => ({
      label, insert: label, desc, group: 'g', kind: 'command' as const,
    }));
    const state: MenuState = {
      items, selected: 0, open: true, kind: 'command', query: '', span: [0, 0],
    };
    const frame = renderLines(
      React.createElement(Menu, { state, t, color: noColor, height: 8, width: 80 }),
      80,
    ).text;

    // 用"说明列 - 标签列"比较：与两侧各自的前缀（标记/边框）无关
    const gapOf = (line: string, label: string, desc: string): number => {
      const a = line.indexOf(label);
      const b = line.indexOf(desc);
      return a >= 0 && b >= 0 ? b - a : -1;
    };
    const bad: string[] = [];
    for (const [label, desc] of ITEMS) {
      const pyLine = pyRows!.find((r) => r.includes(label) && r.includes(desc)) ?? '';
      const tsLine = frame.split('\n').find((r) => r.includes(label) && r.includes(desc)) ?? '';
      if (!pyLine || !tsLine) { bad.push(`${label}: 有一侧没渲染出来`); continue; }
      if (gapOf(pyLine, label, desc) !== gapOf(tsLine, label, desc)) {
        bad.push(`${label}: ts=${gapOf(tsLine, label, desc)} py=${gapOf(pyLine, label, desc)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('R-8 列表选中标记 = `▶`（与"提示符 `❯`"分开）', () => {
  // 证据（本仓内部一致性）：Python 的**列表选中**语义在四处都用 `▶` ——
  // `ace_menu` / `ace_selector` / `ace_dialog` / `ace_home`；而 `❯` 在 Python 里
  // 主要是**提示符 / 说话人**语义（`ace_cards` 的 user 前缀、`ace_fullscreen` 的 prompt）。
  // TS 此前把列表选中也写成 `❯`，与那四处不一致 —— 也与它**自己**的 `Input` 提示符撞了。
  //
  // **如实记一个例外**：Python 的 `ace_panel.menu_rows`（主页/面板那份**编号菜单**）
  // 用的是 `❯` —— 所以 Python 侧是 **4:1** 而不是完全一致。那一份语义更靠近"提示符列表"
  // （`❯ 1. 进入聊天`），**本卡不动它**；要收的话是下一条小项。
  const PY_MARKERS = ['ui/ace_menu.py', 'ui/ace_selector.py', 'ui/ace_dialog.py', 'ui/ace_home.py'];
  const TS_MARKERS = ['frontend/src/components/Menu.tsx',
                      'frontend/src/components/ChoiceDialog.tsx',
                      'frontend/src/components/PermissionDialog.tsx'];

  it('Python 侧四处一致用 `▶`（解析护栏：先证明这条"一致性"是真的）', () => {
    const miss = PY_MARKERS.filter((rel) => !readPy(rel).includes('▶'));
    expect(miss).toEqual([]);
  });

  it('★TS 侧的列表选中标记也是 `▶`，且不再混用 `❯`', () => {
    const bad: string[] = [];
    for (const rel of TS_MARKERS) {
      const src = readPy(rel);
      if (!src.includes("'▶ '")) bad.push(`${rel}: 没有 '▶ '`);
      if (src.includes("'❯ '")) bad.push(`${rel}: 仍混用 '❯ '`);
    }
    expect(bad).toEqual([]);
  });

  it('★渲染级：菜单的选中行两侧都画 `▶`', () => {
    const items: MenuItem[] = [{ label: '/help', insert: '/help', desc: 'd', group: 'g', kind: 'command' }];
    const state: MenuState = { items, selected: 0, open: true, kind: 'command', query: '', span: [0, 0] };
    const frame = renderLines(
      React.createElement(Menu, { state, t, color: noColor, height: 8, width: 80 }),
      80,
    ).text;
    expect(frame).toContain('▶');
    expect(frame).not.toContain('❯');
  });
});

describe('R-9 菜单分组标题的**前缀** = `── 组名`', () => {
  // 证据：Python 的**设计版**分组标题就是 `── 组名 ────`（`ui/ace_panel.section_title`），
  // 被主页/面板用着；`ace_menu` 里那个光秃秃的 `  group` 才是异类。TS 已用 `──`。
  // **只收前缀**：右侧补满属于各外壳的排版（`THREE-LAYERS` N-1 那条"同一份数据各自排版"）。
  // 用**行为**做护栏，不用正则 —— 这条正则我已经写错过一次（函数叫 `section` 不是
  // `section_title`）。行为级护栏不依赖名字，也就不会有"解析错了却以为是代码错了"的假红。
  const pySection = pythonJson([
    'import json, sys',
    'from ui import ace_panel as p',
    'print(json.dumps(p.section("组名", 20)))',
  ].join('\n'), null) as string | null;

  it.skipIf(pySection === null)('护栏：`ace_panel.section` 渲染出的分组标题确实以 `── ` 起头', () => {
    expect(pySection).toContain('── 组名');
  });

  it('★浏览器/菜单渲染出的分组行以 `── 组名` 起头（TS 侧已经如此）', () => {
    const items: MenuItem[] = [
      { label: '/help', insert: '/help', desc: 'd', group: 'grp', kind: 'command' },
      { label: '/model', insert: '/model', desc: 'd2', group: 'grp', kind: 'command' },
    ];
    const state: MenuState = { items, selected: 0, open: true, kind: 'command', query: '', span: [0, 0] };
    const frame = renderLines(
      React.createElement(Menu, { state, t, color: noColor, height: 8, width: 80 }),
      80,
    ).text;
    expect(frame).toContain('── grp');
  });

  const pyGroupRows = pythonJson([
    'import json, sys',
    'from ui import ace_menu as m',
    'st = m.MenuState([m.MenuItem("/help", "/help", "d", "grp", "command")], 0, True, "command")',
    'print(json.dumps(m.render_menu(st, 80, max_rows=8, translate=lambda k: k)))',
  ].join('\n'), null) as string[] | null;

  it.skipIf(pyGroupRows === null)('★Python 侧的菜单分组行同前缀（渲染级，对着真 Python）', () => {
    const groupRow = pyGroupRows!.find((r) => r.includes('grp')) ?? '';
    expect(groupRow, `分组行里没有 ── 前缀: ${JSON.stringify(pyGroupRows)}`).toContain('── grp');
  });
});

