/**
 * 设置面板 —— 声明式 schema + 渲染器 + 键盘。
 *
 * 分三层测，各测各的：
 *   ① **纯函数**（`schema.ts`）：解析的防御性、取值/写通道、行规划、搜索评分、焦点移动。
 *   ② **帧**（`renderLines`，纯渲染、无 stdin）：版面（左对齐 / 值列定宽右对齐 / 无边框 /
 *      不用 `─`）、分行呈现（inline 摊开 vs page 导航行）、凭据不回显。
 *   ③ **按键 → 帧 + 回调**（`mountTree`）：改完**立即**回调（没有"保存"键）、非法值不落库、
 *      搜索、退层、窗口滚动。这一层是"实测"—— 断言的是**帧里的字**与**收到的命令行**，
 *      不是组件内部状态。
 *
 * 键位字节：`Enter`=`\r`、`Esc`=`\x1b`（裸 ESC 要等内核 50ms 转义超时）、
 * 方向键 = `\x1b[A/B/C/D`（同 `input-editor.test.tsx` 的口径）。
 */

import { describe, expect, it } from 'vitest';

import { SettingsPanel } from '../src/components/settings/SettingsPanel.js';
import {
  PANEL_KEYS,
  boolValue,
  checkDraft,
  cycleValue,
  editability,
  focusableRows,
  moveFocusId,
  panelRows,
  parseSettings,
  rowIndexOf,
  writeCommandFor,
} from '../src/components/settings/schema.js';
import { SUPPORTED, loadDict } from '../src/i18n.js';
import { displayWidth } from '../src/render/text.js';
import { renderLines } from './helpers/screen.js';
import { mountTree } from './mount.js';

const DOWN = '\x1b[B';
const RIGHT = '\x1b[C';
const ENTER = '\r';
const ESC = '\x1b';

const t = (key: string): string => key;
const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 逐键按 —— **一次 `stdin.write` 只送一个键**。
 * 把 `DOWN + DOWN` 一次写进去，内核只解出**一个**按键事件（实测：焦点只动一格），
 * 所以连按必须分开写、每次等一帧。
 */
async function press(tree: { stdin: { write(data: string): void } }, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    tree.stdin.write(key);
    await tick(20);
  }
}

/** `settings.request` 的返回，形状照 `DshShell-AceCapabilities.md` §3.7c。 */
function payload(current: Record<string, string> = {}): unknown {
  return {
    sections: [
      {
        id: 'security',
        label_key: 'set_sec',
        groups: [
          { id: 'general', label_key: 'set_group_general', mode: 'inline' },
          { id: 'permission', label_key: 'set_group_perm', mode: 'page' },
        ],
        items: [
          {
            key: 'net', type: 'boolean', current: current.net ?? 'off', default: 'off',
            scope: 'global', label_key: 'set_net', write_cmd: '/net {value}', hot: true, group: 'general',
          },
          {
            key: 'vim', type: 'boolean', current: 'on', default: 'off',
            scope: 'global', label_key: 'set_vim', write_cmd: '/vim {value}', hot: true, group: 'general',
          },
          {
            key: 'api_key', type: 'str', set: true, default: '',
            scope: 'global', label_key: 'set_api_key', write_cmd: '/config', secret: true, hot: false,
            group: 'general',
          },
          {
            key: 'page_margin', type: 'number', current: '2', default: '2',
            scope: 'global', label_key: 'set_margin', write_cmd: '/margin {value}', hot: true, group: 'general',
          },
          {
            key: 'keybindings', type: 'str', current: '', default: '',
            scope: 'global', label_key: 'set_keys', write_cmd: '', hot: false, group: 'general',
          },
          {
            key: 'permission', type: 'enum', current: current.permission ?? 'readonly', default: 'readonly',
            enum: [['readonly', 'perm_readonly'], ['write', 'perm_write'], ['full', 'perm_full']],
            scope: 'global', label_key: 'set_permission', write_cmd: '/permission {value}', hot: true,
            group: 'permission',
          },
          {
            key: 'sandbox', type: 'enum', current: 'job', default: 'off',
            enum: [['off', 'arg_sandbox_off'], ['job', 'arg_sandbox_job'], ['docker', 'arg_sandbox_docker']],
            scope: 'global', label_key: 'set_sandbox', write_cmd: '/sandbox {value}', hot: true,
            group: 'permission',
          },
        ],
      },
    ],
  };
}

const sections = (current: Record<string, string> = {}): ReturnType<typeof parseSettings> =>
  parseSettings(payload(current));

// ============================================================
// ① 纯函数：解析（对缺字段的防御）
// ============================================================

describe('schema：解析 settings.request（协议扩展还在路上 ⇒ 处处防御）', () => {
  it('§3.7c 的形状能认全：`str`→字符串、`enum` 的 [值,键] 对、`boolean` 的 on/off 词表', () => {
    const [section] = sections();
    expect(section!.id).toBe('security');
    const byKey = new Map(section!.items.map((i) => [i.key, i]));
    expect(byKey.get('api_key')!.kind).toBe('string');
    expect(byKey.get('permission')!.kind).toBe('enum');
    expect(byKey.get('net')!.kind).toBe('boolean');
    expect(byKey.get('page_margin')!.kind).toBe('number');
    expect(byKey.get('permission')!.options.map((o) => o.value)).toEqual(['readonly', 'write', 'full']);
    expect(byKey.get('permission')!.options[1]!.labelKey).toBe('perm_write');
    // 布尔可以自报词表（`values`）；枚举不吃这个词表（它有自己的 options）
    const custom = parseSettings({
      sections: [{ id: 's', items: [{ key: 'flag', type: 'boolean', current: 'false', values: ['false', 'true'], write_cmd: '/flag {value}' }] }],
    });
    expect(custom[0]!.items[0]!.values).toEqual(['false', 'true']);
    expect(writeCommandFor(custom[0]!.items[0]!, 'true')).toBe('/flag true');
    expect(byKey.get('sandbox')!.values).toEqual(['off', 'on']); // 没自报就落默认词表
  });

  it('凭据项没有 current：即使协议硬塞一个也不显示，只用 `set` 说话', () => {
    const sneaky = payload();
    const item = (sneaky as { sections: { items: Record<string, unknown>[] }[] }).sections[0]!.items
      .find((i) => i.key === 'api_key')!;
    item.current = 'sk-SENTINEL';
    const parsed = parseSettings(sneaky)[0]!.items.find((i) => i.key === 'api_key')!;
    expect(parsed.secret).toBe(true);
    expect(parsed.current).toBeUndefined();
    expect(parsed.isSet).toBe(true);
  });

  it('畸形载荷不崩：null / 非数组 / 没 key 的项 / 非对象的 section 一律丢掉', () => {
    expect(parseSettings(null)).toEqual([]);
    expect(parseSettings({})).toEqual([]);
    expect(parseSettings({ sections: 'nope' })).toEqual([]);
    expect(parseSettings({ sections: [1, null, { items: 'x' }] })).toEqual([]);
    const mixed = parseSettings({
      sections: [{ id: 's', items: [{ type: 'boolean' }, { key: 'ok', type: 'boolean' }] }],
    });
    expect(mixed[0]!.items.map((i) => i.key)).toEqual(['ok']);
  });

  it('认不出的类型不崩也不装懂：落成 unsupported，原始串留着', () => {
    const parsed = parseSettings({
      sections: [{ id: 's', items: [{ key: 'color', type: 'color-picker', current: 'red' }] }],
    });
    const item = parsed[0]!.items[0]!;
    expect(item.kind).toBe('unsupported');
    expect(item.rawType).toBe('color-picker');
    expect(parsed[0]!.groups.map((g) => g.id)).toEqual(['general']); // 没声明分组 ⇒ 补一条 general
  });
});

describe('schema：取值与写通道（纯函数）', () => {
  it('写通道三种形态：有模板=direct、有命令没模板=wizard、没命令=none', () => {
    const items = sections()[0]!.items;
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(editability(byKey.get('net')!)).toBe('direct');
    expect(editability(byKey.get('api_key')!)).toBe('wizard');
    expect(editability(byKey.get('keybindings')!)).toBe('none');
    expect(writeCommandFor(byKey.get('net')!, 'on')).toBe('/net on');
    expect(writeCommandFor(byKey.get('api_key')!, 'whatever')).toBe('/config');
    expect(writeCommandFor(byKey.get('keybindings')!, 'x')).toBe('');
  });

  it('循环取值：枚举两个方向都绕回、当前值不在选项里从第一项开始、文本/数字不动', () => {
    const byKey = new Map(sections()[0]!.items.map((i) => [i.key, i]));
    const perm = byKey.get('permission')!;
    expect(cycleValue(perm, 1)).toBe('write');
    expect(cycleValue({ ...perm, current: 'full' }, 1)).toBe('readonly');
    expect(cycleValue({ ...perm, current: 'full' }, -1)).toBe('write');
    expect(cycleValue({ ...perm, current: 'unknown' }, 1)).toBe('readonly');
    expect(cycleValue(byKey.get('net')!, 1)).toBe('on'); // boolean：翻到另一头
    expect(cycleValue(byKey.get('page_margin')!, 1)).toBeUndefined();
  });

  it('布尔的读法：认词表与 true/1/yes，其余一律 false（不猜）', () => {
    const net = new Map(sections()[0]!.items.map((i) => [i.key, i])).get('net')!;
    expect(boolValue({ ...net, current: 'on' })).toBe(true);
    expect(boolValue({ ...net, current: 'true' })).toBe(true);
    expect(boolValue({ ...net, current: '1' })).toBe(true);
    expect(boolValue({ ...net, current: 'off' })).toBe(false);
    expect(boolValue({ ...net, current: undefined })).toBe(false);
    expect(boolValue({ ...net, current: 'maybe' })).toBe(false);
  });

  it('草稿校验：数字必须是有限数、文本不许夹控制字节', () => {
    const byKey = new Map(sections()[0]!.items.map((i) => [i.key, i]));
    expect(checkDraft(byKey.get('page_margin')!, '3')).toEqual({ ok: true, value: '3' });
    expect(checkDraft(byKey.get('page_margin')!, ' 2 ')).toEqual({ ok: true, value: '2' });
    expect(checkDraft(byKey.get('page_margin')!, '2x').ok).toBe(false);
    expect(checkDraft(byKey.get('page_margin')!, '').ok).toBe(false);
    expect(checkDraft(byKey.get('keybindings')!, 'ctrl+k').ok).toBe(true);
    expect(checkDraft(byKey.get('keybindings')!, 'bad\u001bseq').ok).toBe(false);
  });
});

describe('schema：行规划（渲染器与焦点表共用同一个函数）', () => {
  it('inline 分组就地摊开；page 分组只留一行导航（带条目数）', () => {
    const rows = panelRows(sections(), {}, t);
    expect(rows.map((r) => (r.kind === 'field' ? r.item.key : r.kind === 'page' ? `page:${r.group.id}` : `h:${r.labelKey}`))).toEqual([
      'h:set_group_general',
      'net',
      'vim',
      'api_key',
      'page_margin',
      'keybindings',
      'page:permission',
    ]);
    const page = rows.find((r) => r.kind === 'page');
    expect(page !== undefined && page.kind === 'page' ? page.count : 0).toBe(2);
  });

  it('子页只画该分组的字段（不再重复根页的行）', () => {
    const rows = panelRows(sections(), { groupId: 'permission' }, t);
    expect(rows.map((r) => (r.kind === 'field' ? r.item.key : r.kind))).toEqual(['permission', 'sandbox']);
  });

  it('搜索是**全局**的：藏在子页里的设置也能搜到（否则搜索等于没用）', () => {
    const hit = panelRows(sections(), { query: 'sand' }, t);
    expect(hit.map((r) => (r.kind === 'field' ? r.item.key : r.kind))).toEqual(['sandbox']);
    // 子页开着时搜索同样压平（`initialGroupId` 不会把搜索关进那一页）
    expect(panelRows(sections(), { groupId: 'permission', query: 'net' }, t).map((r) => (r.kind === 'field' ? r.item.key : r.kind)))
      .toEqual(['net']);
    expect(panelRows(sections(), { query: 'zzzz' }, t)).toEqual([]);
  });

  it('焦点只落在非标题行上，移动不循环、不越界', () => {
    const rows = panelRows(sections(), {}, t);
    expect(focusableRows(rows).map((r) => (r.kind === 'field' ? r.item.key : r.kind === 'page' ? r.group.id : r.id))).toEqual([
      'net', 'vim', 'api_key', 'page_margin', 'keybindings', 'permission',
    ]);
    const first = focusableRows(rows)[0]!.id;
    expect(moveFocusId(rows, first, -1)).toBe(first); // 到顶不回绕
    const last = focusableRows(rows)[5]!.id;
    expect(moveFocusId(rows, last, 1)).toBe(last); // 到底不回绕
    expect(moveFocusId(rows, null, 1)).toBe(focusableRows(rows)[1]!.id); // 无焦点时从第一项起算
    expect(rowIndexOf(rows, first)).toBe(1); // 标题也占一行 ⇒ 窗口按它算
  });
});

// ============================================================
// ② 帧（纯渲染）
// ============================================================

describe('SettingsPanel：版面（Swiss —— 不画边框、值列定宽右对齐、不用 `─`）', () => {
  it('根页：标题 + 整宽细线 + inline 分组 + 导航行；每一行的值都对齐到同一列', () => {
    const frame = renderLines(
      <SettingsPanel sections={sections()} t={t} onWrite={() => {}} width={80} />,
      80,
    );
    expect(frame.lines[0]).toBe('set_title');
    expect(frame.text).not.toContain('─'); // 规范 §1.2：Ambiguous 宽度，GBK 下双宽
    expect(frame.text).not.toContain('│');
    expect(frame.text).not.toContain('╭');
    // 分组导航行：标签 + 计数
    expect(frame.lineWith('set_group_perm')).toContain('(2)');
    // 值列紧贴右边缘（80 列 -> 79，最后 1 列不用）⇒ 三行的值都收在同一列 = 定宽右对齐
    for (const [needle, value] of [['set_net', 'arg_off'], ['set_vim', 'arg_on'], ['set_margin', '2']] as const) {
      const line = frame.lineWith(needle)!;
      expect(line.endsWith(value)).toBe(true);
      expect(displayWidth(line)).toBe(79);
    }
    expect(frame.lineWith('set_api_key')).toContain('set_secret_set');
    expect(frame.lineWith('set_keys')).toContain('set_chip_readonly');
    expect(frame.text).toContain('set_hint_list');
  });

  it('凭据只在帧里露出"已设置 / 未设置"，永远不露内容', () => {
    const shown = renderLines(
      <SettingsPanel sections={sections()} t={t} onWrite={() => {}} width={80} />,
      80,
    );
    expect(shown.text).toContain('set_secret_set');
    expect(shown.text).not.toContain('sk-');

    const unset = parseSettings({
      sections: [{ id: 's', items: [{ key: 'token', type: 'str', secret: true, set: false, write_cmd: '/config' }] }],
    });
    const frame = renderLines(<SettingsPanel sections={unset} t={t} onWrite={() => {}} width={80} />, 80);
    expect(frame.text).toContain('set_secret_unset');
  });

  it('page 分组的子页：只画那一组的字段', () => {
    const frame = renderLines(
      <SettingsPanel sections={sections()} t={t} onWrite={() => {}} width={80} initialGroupId="permission" />,
      80,
    );
    expect(frame.text).toContain('set_permission');
    expect(frame.text).toContain('perm_readonly');
    expect(frame.text).toContain('set_sandbox');
    expect(frame.text).not.toContain('set_net');
    expect(frame.text).not.toContain('set_group_general');
  });

  it('没有任何设置项时给一句话，不是一张空屏', () => {
    const frame = renderLines(<SettingsPanel sections={[]} t={t} onWrite={() => {}} width={80} />, 80);
    expect(frame.text).toContain('set_empty');
  });
});

// ============================================================
// ③ 按键 → 帧 + 回调
// ============================================================

describe('SettingsPanel：按键 → 帧与回调', () => {
  it('↓ 移动焦点：帧里的 `❯` 换了一行（状态变化看得见）', async () => {
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={() => {}} />);
    await tick();
    expect(tree.lastFrame()).toContain('❯ set_net');
    tree.stdin.write(DOWN);
    await tick();
    expect(tree.lastFrame()).toContain('❯ set_vim');
    expect(tree.lastFrame()).not.toContain('❯ set_net');
    tree.unmount();
  });

  it('回车切布尔 = **立即**回调 `command.exec` 该发的那一行（没有"保存"键）', async () => {
    const writes: string[] = [];
    const view = (net: string): React.ReactElement => (
      <SettingsPanel sections={sections({ net })} t={t} onWrite={(c) => writes.push(c)} />
    );
    const tree = mountTree(view('off'));
    await tick();
    tree.stdin.write(ENTER); // 焦点在 net（off）→ 切到 on
    await tick();
    expect(writes).toEqual(['/net on']);
    // 面板**不持有**值：引擎回传新值之后，再按一次才是翻回去（这正是"唯一真源"的形状）
    tree.rerender(view('on'));
    await tick();
    expect(tree.lastFrame()).toContain('arg_on');
    tree.stdin.write(ENTER);
    await tick();
    expect(writes).toEqual(['/net on', '/net off']);
    tree.unmount();
  });

  it('枚举 ←/→ 循环并立即回调；引擎回传新值后帧真的变了（走完整条回路）', async () => {
    const writes: string[] = [];
    const view = (cur: Record<string, string>): React.ReactElement => (
      <SettingsPanel
        sections={sections(cur)}
        t={t}
        onWrite={(c) => writes.push(c)}
        initialGroupId="permission"
      />
    );
    const tree = mountTree(view({}));
    await tick();
    expect(tree.lastFrame()).toContain('perm_readonly');
    tree.stdin.write(RIGHT);
    await tick();
    expect(writes).toEqual(['/permission write']);
    tree.stdin.write('\x1b[D'); // ←
    await tick();
    expect(writes).toEqual(['/permission write', '/permission full']);
    tree.rerender(view({ permission: 'write' }));
    await tick();
    expect(tree.lastFrame()).toContain('perm_write');
    tree.unmount();
  });

  it('文本/数字：回车进编辑态 → 键入 → 回车即写回；非法值不落库、留在编辑器里报错', async () => {
    const writes: string[] = [];
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={(c) => writes.push(c)} />);
    await tick();
    await press(tree, DOWN, DOWN, DOWN); // net → vim → api_key → page_margin
    expect(tree.lastFrame()).toContain('❯ set_margin');
    tree.stdin.write(ENTER);
    await tick();
    expect(tree.lastFrame()).toContain('set_hint_edit'); // 进编辑态了
    tree.stdin.write('7');
    await tick();
    tree.stdin.write(ENTER);
    await tick();
    expect(writes).toEqual(['/margin 27']); // 草稿是 '2' + '7'

    // 非法值：再进编辑、键入 'x' → 回车不写、帧里出现错误徽标
    tree.stdin.write(ENTER);
    await tick();
    tree.stdin.write('x');
    await tick();
    tree.stdin.write(ENTER);
    await tick();
    expect(writes).toEqual(['/margin 27']);
    expect(tree.lastFrame()).toContain('set_invalid');
    tree.stdin.write(ESC);
    await tick(90);
    expect(tree.lastFrame()).not.toContain('set_invalid');
    tree.unmount();
  });

  it('凭据项（只有命令没有模板）：回车走向导那条命令，帧里永远没有值', async () => {
    const writes: string[] = [];
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={(c) => writes.push(c)} />);
    await tick();
    await press(tree, DOWN, DOWN); // → api_key
    expect(tree.lastFrame()).toContain('❯ set_api_key');
    expect(tree.lastFrame()).toContain('set_chip_wizard');
    tree.stdin.write(ENTER);
    await tick();
    expect(writes).toEqual(['/config']); // §3.7c 的降级路径：发命令 = 开向导
    expect(tree.lastFrame()).not.toContain('set_hint_edit'); // 不进编辑态 ⇒ 没有草稿可回显
    tree.unmount();
  });

  it('凭据项（能直接写回）：编辑态只画掩码 —— 键入的字符不进帧，值只进命令行', async () => {
    const writes: string[] = [];
    // 真实形状里凭据的 `write_cmd` 是 `/config`（向导，见上一条）；这里造一个带模板的，
    // 专门压住"能直接写回的凭据"这条路径 —— 它才是回显风险最大的那条。
    const secret = parseSettings({
      sections: [{
        id: 's',
        items: [{
          key: 'token', type: 'str', secret: true, set: false, default: '',
          label_key: 'set_api_key', write_cmd: '/token {value}', hot: true,
        }],
      }],
    });
    const tree = mountTree(<SettingsPanel sections={secret} t={t} onWrite={(c) => writes.push(c)} />);
    await tick();
    expect(tree.lastFrame()).toContain('set_secret_unset');
    tree.stdin.write(ENTER);
    await tick();
    expect(tree.lastFrame()).toContain('set_hint_edit');
    tree.stdin.write('sk-123');
    await tick();
    expect(tree.lastFrame()).not.toContain('sk-123');
    expect(tree.lastFrame()).toContain('••••••');
    tree.stdin.write(ENTER);
    await tick();
    expect(writes).toEqual(['/token sk-123']); // 掩码只管显示，写回去的是真值
    tree.unmount();
  });

  it('没有写命令的项：回车**不**发命令，底部明说为什么（不许静默吞掉）', async () => {
    const writes: string[] = [];
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={(c) => writes.push(c)} />);
    await tick();
    await press(tree, DOWN, DOWN, DOWN, DOWN); // → keybindings
    expect(tree.lastFrame()).toContain('❯ set_keys');
    expect(tree.lastFrame()).toContain('set_no_write');
    tree.stdin.write(ENTER);
    await tick();
    expect(writes).toEqual([]);
    tree.unmount();
  });

  it('回车进 page 分组、Esc 退回根页（退层不退出面板）', async () => {
    let closed = 0;
    const tree = mountTree(
      <SettingsPanel sections={sections()} t={t} onWrite={() => {}} onClose={() => { closed += 1; }} />,
    );
    await tick();
    await press(tree, DOWN, DOWN, DOWN, DOWN, DOWN); // → 分组导航行
    expect(tree.lastFrame()).toContain('❯ set_group_perm');
    tree.stdin.write(ENTER);
    await tick();
    expect(tree.lastFrame()).toContain('perm_readonly');
    tree.stdin.write(ESC);
    await tick(90);
    expect(closed).toBe(0); // 只退一层
    expect(tree.lastFrame()).toContain('set_group_general');
    tree.stdin.write(ESC);
    await tick(90);
    expect(closed).toBe(1); // 根页再 Esc 才是离开
    tree.unmount();
  });

  it('设置内搜索：`/` 开筛选、只留命中的行、回车保留筛选、Esc 清空', async () => {
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={() => {}} />);
    await tick();
    expect(tree.lastFrame()).toContain('set_net');
    await press(tree, '/');
    expect(tree.lastFrame()).toContain('set_hint_search');
    tree.stdin.write('sand');
    await tick();
    expect(tree.lastFrame()).toContain('set_search_label');
    expect(tree.lastFrame()).toContain('set_sandbox'); // 子页里的设置也搜得到
    expect(tree.lastFrame()).not.toContain('set_net');
    tree.stdin.write(ENTER); // 收起输入、保留筛选
    await tick();
    expect(tree.lastFrame()).not.toContain('set_hint_search');
    expect(tree.lastFrame()).toContain('set_sandbox');
    expect(tree.lastFrame()).not.toContain('set_net');
    tree.stdin.write(ESC); // 清筛选
    await tick(90);
    expect(tree.lastFrame()).toContain('set_net');
    tree.unmount();
  });

  it('搜索无结果时给一句话，不是空屏', async () => {
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={() => {}} />);
    await tick();
    await press(tree, '/');
    tree.stdin.write('zzzz');
    await tick();
    expect(tree.lastFrame()).toContain('set_search_empty');
    tree.unmount();
  });

  it('列表超过高度时窗口跟着焦点滚，并如实说明下面还藏了多少', async () => {
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={() => {}} height={2} />);
    await tick();
    expect(tree.lastFrame()).toContain('menu_more'); // 7 行只画 2 行
    await press(tree, DOWN, DOWN, DOWN);
    expect(tree.lastFrame()).toContain('menu_more_above'); // 上面也有被挡住的
    expect(tree.lastFrame()).toContain('❯ set_margin');
    tree.unmount();
  });

  it('disabled：让出键盘，按键不产生任何写动作', async () => {
    const writes: string[] = [];
    const tree = mountTree(<SettingsPanel sections={sections()} t={t} onWrite={(c) => writes.push(c)} disabled />);
    await tick();
    await press(tree, ENTER, DOWN, RIGHT, '/', 'x');
    expect(writes).toEqual([]);
    tree.unmount();
  });
});

// ============================================================
// ④ 文案键：本波的 `locales/*.json` 归别人 ⇒ 这里只钉"已落地的必须三语齐备"
// ============================================================

describe('设置面板的文案键', () => {
  it('键名集中一处、唯一、都在 set_ 命名空间下', () => {
    const keys = Object.values(PANEL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith('set_'))).toBe(true);
    expect(keys.length).toBeGreaterThanOrEqual(15);
  });

  it('已落进字典的键必须三语齐备（半套 = 那种语言下露键名）', () => {
    const dicts = SUPPORTED.map((lang) => loadDict(lang));
    const present = (key: string): boolean => dicts.some((d) => key in d);
    const half = Object.values(PANEL_KEYS).filter((key) => present(key) && !dicts.every((d) => key in d));
    expect(half).toEqual([]);
  });
});
