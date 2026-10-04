/**
 * 补全菜单的**模型** —— 逐条照抄 `ui/ace_menu.py` 的产品口径。
 *
 * 为什么要与 Python 侧一致：菜单的开合规则和回车语义是**用户肌肉记忆**的一部分。
 * 两套前端若不同，用户换一次前端就要重新学一遍"打完命令要不要再按回车"。
 *
 * 三条关键口径（都写在那边的 docstring 里）：
 *   1. **不弹就是关** —— 命令已打全 / 普通文本时不弹菜单，用户不必按 Esc 关它，
 *      回车直接发送。"打完命令回车发出去"这个直觉必须成立。
 *   2. **回车语义**：候选与已输入内容不同 → 先补全（不发送）；已经一致 → 直接发送。
 *      这是"菜单不碍事"的关键，否则用户打完 `/help` 还要多按一次回车。
 *   3. 候选排序用 `render/match.ts` 那套评分 —— **与选择器同一套**。
 *
 * 纯逻辑：不碰 Ink、不读终端宽度（`windowBounds` 只算，画由组件做）。
 */

import { filterItems } from './match.js';
import { displayWidth } from './text.js';

export interface MenuItem {
  /** 给人看的标签 */
  label: string;
  /** 回车/Tab 后真正填进输入框的文本 */
  insert: string;
  /** 说明（已翻译） */
  desc: string;
  /** 分组标题（已翻译） */
  group: string;
  kind: 'command' | 'custom' | 'mention' | 'argument';
}

export interface MenuState {
  items: MenuItem[];
  selected: number;
  open: boolean;
  kind: string;
  query: string;
  /** 当前词在输入串里的区间 `[start, end)` —— 补全时替换这一段。 */
  span: [number, number];
}

/** `@` 提及的五类（顺序 = 菜单里的展示顺序）。与 `ace_menu.MENTION_TRIGGERS` 一致。 */
export const MENTION_TRIGGERS: Array<[string, string]> = [
  ['lang', 'at_complete_lang'],
  ['skill', 'at_complete_skill'],
  ['file', 'at_complete_file'],
  ['folder', 'at_complete_folder'],
  ['session', 'at_complete_session'],
];

/**
 * 命令的参数提示：命令 → [(参数, 说明 i18n 键)]。
 * 有提示的命令输入空格后即弹参数菜单 —— "下一步能填什么"应该在光标旁边。
 */
export const ARGUMENT_HINTS: Record<string, Array<[string, string]>> = {
  '/permission': [
    ['readonly', 'arg_perm_readonly'],
    ['write', 'arg_perm_write'],
    ['full', 'arg_perm_full'],
    ['rules', 'arg_perm_rules'],
  ],
  '/sandbox': [
    ['off', 'arg_sandbox_off'],
    ['job', 'arg_sandbox_job'],
    ['docker', 'arg_sandbox_docker'],
  ],
  '/net': [
    ['on', 'arg_net_on'],
    ['off', 'arg_net_off'],
  ],
  '/thinking': [
    ['on', 'arg_on'],
    ['off', 'arg_off'],
  ],
  '/style': [
    ['default', 'style_default'],
    ['concise', 'style_concise'],
    ['explanatory', 'style_explanatory'],
    ['strict', 'style_strict'],
  ],
  '/fullscreen': [
    ['on', 'arg_on'],
    ['off', 'arg_off'],
  ],
  // 有固定取值的命令都在这张表里 —— 用户不必去翻 /help 或背 `readonly/write/full`。
  // 加一条的前提只有一个：这条命令的参数**确实**是闭集（开集参数如 `/search` 不加，
  // 加了会让光标旁边弹出一个"看起来能选、其实还得自己写"的假菜单）。
  // 与 `ui/ace_menu.ARGUMENT_HINTS` 同表 —— 由 test_all 的跨语言对拍钉住（漏一边就红）。
  '/lang': [
    ['zh', 'arg_lang_zh'],
    ['en', 'arg_lang_en'],
    ['ja', 'arg_lang_ja'],
  ],
  '/effort': [
    ['auto', 'effort_auto'],
    ['low', 'effort_low'],
    ['medium', 'effort_medium'],
    ['high', 'effort_high'],
    ['max', 'effort_max'],
  ],
  '/vim': [
    ['on', 'arg_on'],
    ['off', 'arg_off'],
  ],
  '/mock': [
    ['on', 'arg_on'],
    ['off', 'arg_off'],
  ],
  '/expandall': [
    ['on', 'arg_on'],
    ['off', 'arg_off'],
  ],
  '/goal': [
    ['resume', 'arg_goal_resume'],
    ['pause', 'arg_goal_pause'],
    ['complete', 'arg_goal_complete'],
  ],
  '/audit': [
    ['stats', 'arg_audit_stats'],
    ['boundary', 'arg_audit_boundary'],
  ],
  '/rules': [
    ['add', 'arg_rules_add'],
    ['remove', 'arg_rules_remove'],
    ['check', 'arg_rules_check'],
    ['accept', 'arg_rules_accept'],
  ],
  '/todo': [
    ['add', 'arg_todo_add'],
    ['start', 'arg_todo_start'],
    ['done', 'arg_todo_done'],
    ['remove', 'arg_todo_remove'],
    ['clear', 'arg_todo_clear'],
  ],
  '/queue': [['clear', 'arg_clear']],
  '/stash': [
    ['pop', 'arg_stash_pop'],
    ['clear', 'arg_clear'],
  ],
  '/tasks': [],
};

export type Translate = (key: string) => string;

/**
 * 命令 → 当前状态里的字段名。
 *
 * 菜单里那行「（当前 xxx）」据此内联 —— 只写「切换权限」而不写**现在是哪一档**，
 * 用户还得敲一次 `/permission` 才知道自己在哪儿。这与主页"每行右侧给当前值"
 * 是同一条口径（也复用同一份 `home_state()`）。
 */
export const CURRENT_VALUE: Record<string, string> = {
  '/model': 'model',
  '/permission': 'permission',
  '/sandbox': 'sandbox',
  '/effort': 'effort',
  '/net': 'net',
  '/lang': 'lang',
  '/vim': 'vim',
};

/** 开关类字段 → 开/关的展示文案（复用已有的 `arg_on` / `arg_off`）。 */
function switchText(v: unknown, tr: Translate): string {
  if (typeof v === 'boolean') return v ? tr('arg_on') : tr('arg_off');
  const s = String(v ?? '').toLowerCase();
  if (s === 'on' || s === 'true' || s === '1') return tr('arg_on');
  if (s === 'off' || s === 'false' || s === '0') return tr('arg_off');
  return String(v ?? '');
}

/**
 * 给菜单候选补上「（当前 xxx）」。取不到值时返回原说明 —— **不显示"当前 ??"**，
 * 那比不显示更糟：用户会以为状态丢了。
 */
export function describeWithCurrent(
  cmd: string,
  desc: string,
  state: Record<string, unknown>,
  tr: Translate,
): string {
  const field = CURRENT_VALUE[cmd];
  if (!field) return desc;
  const raw = state[field];
  if (raw === undefined || raw === null || raw === '') return desc;
  const value = field === 'vim' || field === 'net' ? switchText(raw, tr) : String(raw);
  if (!value) return desc;
  return `${desc} ${tr('menu_current_value').replace('{value}', value)}`;
}

const identity: Translate = (k) => k;

export function commandItems(
  commands: Record<string, string>,
  opts: {
    custom?: Array<[string, string]>;
    translate?: Translate;
    groupOf?: (name: string) => string;
    /** 当前状态（`config.request` 的返回）：给有状态的那几个命令补「（当前 xxx）」。 */
    state?: Record<string, unknown>;
  } = {},
): MenuItem[] {
  const tr = opts.translate ?? identity;
  const state = opts.state ?? {};
  const out: MenuItem[] = [];
  for (const [name, descKey] of Object.entries(commands ?? {})) {
    // **有取值表的命令，补全时带上那个空格** —— 于是"选了 `/todo`，下一层选项立刻出来"。
    // 不带空格的后果（实测）：命令名一打全，菜单按"不弹就是关"关闭，第二层**永远不出现**，
    // 用户只能自己猜"后面还有没有东西"。没有取值表的命令不带空格：那样回车直接发送。
    const hasArgs = (ARGUMENT_HINTS[name]?.length ?? 0) > 0;
    out.push({
      label: name,
      insert: hasArgs ? `${name} ` : name,
      desc: describeWithCurrent(name, tr(descKey), state, tr),
      group: opts.groupOf ? tr(opts.groupOf(name)) : '',
      kind: 'command',
    });
  }
  for (const [name, desc] of opts.custom ?? []) {
    out.push({ label: String(name), insert: String(name), desc: String(desc), group: tr('group_custom'), kind: 'custom' });
  }
  return out;
}

/**
 * 取值可以是**字符串**（标签即插入值，如 `@lang` 的 `zh`），也可以是
 * **`[标签, 插入值]` 二元组** —— `@session` 需要这个：菜单里要显示
 * 「1. 缓存穿透 · 2 轮」让人认得出是哪次，但插进输入框的必须是 `1`（编号）。
 * 只给标签的话补全后得到一句人话，引擎解析不了；只给编号则用户不知道选的是哪次。
 *
 * （与 `ui/ace_menu.mention_items` 同一口径。）
 */
export type MentionValue = string | [string, string];

export function mentionItems(
  kind = '',
  opts: { translate?: Translate; values?: readonly MentionValue[] } = {},
): MenuItem[] {
  const tr = opts.translate ?? identity;
  if (!kind) {
    return MENTION_TRIGGERS.map(([k, descKey]) => ({
      label: `@${k}`,
      insert: `@${k} `,
      desc: tr(descKey),
      group: tr('group_extend'),
      kind: 'mention' as const,
    }));
  }
  return (opts.values ?? []).map((v) => {
    const [label, insert] = Array.isArray(v)
      ? [String(v[0]), String(v[1])]
      : [String(v), String(v)];
    return {
      label,
      insert: `${insert} `,
      desc: '',
      group: tr('group_extend'),
      kind: 'mention' as const,
    };
  });
}

export function argumentItems(cmd: string, translate: Translate = identity): MenuItem[] {
  const hints = ARGUMENT_HINTS[String(cmd ?? '')];
  if (!hints) return [];
  return hints.map(([a, descKey]) => ({
    label: String(a),
    insert: `${a} `,
    desc: translate(descKey),
    group: translate(cmd),
    kind: 'argument' as const,
  }));
}

/** 光标处的"词"：返回 `[token, start, end)`，以空白为界。 */
export function tokenUnderCursor(text: string, cursor: number): [string, number, number] {
  const t = String(text ?? '');
  const cur = Math.max(0, Math.min(Math.trunc(cursor), t.length));
  let start = cur;
  while (start > 0 && !/\s/.test(t[start - 1]!)) start--;
  let end = cur;
  while (end < t.length && !/\s/.test(t[end]!)) end++;
  return [t.slice(start, end), start, end];
}

function ranked(
  items: MenuItem[],
  query: string,
  start: number,
  end: number,
  kind: string,
  limit: number,
): MenuState {
  const labels = items.map((i) => i.label);
  const picked = filterItems(labels, query).map((s) => items[s.index]!);
  const limited = picked.slice(0, Math.max(1, limit));
  return {
    items: limited,
    selected: 0,
    open: limited.length > 0,
    kind,
    query,
    span: [start, end],
  };
}

const CLOSED: MenuState = { items: [], selected: 0, open: false, kind: '', query: '', span: [0, 0] };

export interface BuildMenuOptions {
  commands: Record<string, string>;
  custom?: Array<[string, string]>;
  translate?: Translate;
  groupOf?: (name: string) => string;
  mentionValues?: Record<string, readonly MentionValue[]>;
  limit?: number;
  /** 当前状态（`config.request`）：让 `/model` 这类命令的说明里带上当前值。 */
  state?: Record<string, unknown>;
}

/**
 * 输入 → 菜单状态（**唯一**决定"此刻该弹什么"的地方）。
 *
 * 四种情形，优先级从高到低：`@` 触发词 → `@kind` 取值 → `/` 命令 → 命令参数。
 * 其余 → 关闭。
 */
export function buildMenu(
  text: string,
  cursor: number,
  opts: BuildMenuOptions,
): MenuState {
  const tr = opts.translate ?? identity;
  // **不设条数上限**：`Menu` 组件本身就是滚动窗口（`windowBounds` + "上面/下面还有 N 条"），
  // 选中项永远在窗口里。在这里再砍一刀的后果是"滚到底也看不到剩下的" ——
  // 用户看到 12 条会以为命令/工具就这么多（实测踩过：连测试都要显式传 `limit: 30` 绕开它）。
  // `opts.limit` 仍然保留，给"确实只想要前几条"的调用方用。
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const t = String(text ?? '');
  const cur = Math.max(0, Math.min(Math.trunc(cursor), t.length));
  const [token, start, end] = tokenUnderCursor(t, cur);
  const before = t.slice(0, cur);
  const first = before.trim() ? before.trim().split(/\s+/)[0]! : '';

  // ① 当前词以 `@` 开头 → 提及触发词
  if (token.startsWith('@')) {
    return ranked(mentionItems('', { translate: tr }), token.slice(1), start, end, '@', limit);
  }

  // ② 行首词是 `@kind` 且该 kind 有取值 → 提及取值
  if (first.startsWith('@') && first.length > 1 && before.length > first.length) {
    const kind = first.slice(1);
    const values = opts.mentionValues?.[kind];
    if (values?.length) {
      return ranked(
        mentionItems(kind, { translate: tr, values }),
        token,
        start,
        end,
        `@${kind}`,
        limit,
      );
    }
  }

  // ③ 当前词以 `/` 开头 → 命令菜单
  if (token.startsWith('/')) {
    const items = commandItems(opts.commands, {
      custom: opts.custom,
      translate: tr,
      groupOf: opts.groupOf,
      state: opts.state,
    });
    // 口径 1（本文件开头那三条之一）：**命令名已打全就不弹** —— 回车让给"直接发送"。
    // 漏了这条的症状：打完 `/help` 按回车只是又补出一个空格，得按两次才发得出去。
    if (token.length > 1 && items.some((i) => i.label === token)) {
      return {
        items: items.filter((i) => i.label === token),
        selected: 0,
        open: false,
        kind: 'command',
        query: token,
        span: [start, end],
      };
    }
    return ranked(items, token, start, end, '/', limit);
  }

  // ④ 行首是带参数提示的命令、且已经打过空格 → 参数菜单
  if (first.startsWith('/') && before.length > first.length) {
    const hints = ARGUMENT_HINTS[first];
    if (hints?.length) {
      const known = new Set(hints.map(([a]) => a));
      const used = before.trim().split(/\s+/).slice(1);
      // 参数**已经选好**（`/lang zh `）→ 菜单让位，回车直接发送。
      // 否则菜单会一直"再补一个参数"（`/lang zh zh `），用户永远按不出回车 ——
      // Python 侧探针里踩到过，这条是那次修复的镜像（`ui/ace_menu.build_menu` ④）。
      if (used.some((u) => known.has(u))) return { ...CLOSED };
      const args = argumentItems(first, tr).filter((i) => !used.includes(i.label));
      if (args.length) {
        return ranked(args, token, start, end, `${first} `, limit);
      }
    }
  }

  // 其余：不弹就是关（用户不必按 Esc 关它，回车直接发送）
  return { ...CLOSED };
}

/**
 * 把选中项夹到合法范围。**视图与窗口计算必须用同一个夹法。**
 *
 * 踩过：`windowBounds` 内部把 `selected` 夹住了，而 `Menu` 里画标记那行比的还是
 * **原始的** `state.selected` —— 一旦越界（比如列表变短了、调用方给了旧值），
 * 窗口会绕着末项滚，而**一个 `❯` 都不画**。菜单看着像坏了，却没有报错。
 */
export function clampSelected(state: MenuState): number {
  if (!state.items || state.items.length === 0) return 0;
  return Math.max(0, Math.min(Math.trunc(state.selected), state.items.length - 1));
}

/**
 * 在候选多于可显示行数时，算出该显示哪一段 —— 且**保证选中项一定在窗口内**。
 *
 * 这条是补全菜单最容易错的地方：只按"从头显示前 N 个"画，选中项一超出范围
 * 就从屏幕上消失了 —— 用户按方向键却发现"光标不见了"。
 *
 * ## 窗口要**黏**，不要居中（口径与 `ui/ace_menu.window_bounds` 逐例相同）
 *
 * 选中项还在窗口里时**不动窗口**，只在它越过上/下边界时挪一格。
 * 居中也保证"选中项可见"，但代价是**每按一下方向键整屏都在跳** ——
 * 看起来像界面在抖，而不是光标在走。这正是 Python 侧 docstring 里写的那条理由：
 * "滚动要黏，否则每按一下整屏都在跳"。
 *
 * 到顶 / 到底都**不循环**：列表有头有尾，转圈会让人分不清自己走到哪了。
 *
 * 两边的规则由 `test/shell-parity.test.ts`（**R-5**）对着真 Python **逐例**对拍
 * （此前 TS 是居中、Python 是黏边：33 个用例不同，同一种交互两种手感）。
 */
export function windowBounds(
  total: number,
  selected: number,
  height: number,
): { from: number; to: number; hiddenAbove: number; hiddenBelow: number } {
  const h = Math.max(1, Math.trunc(height));
  const t = Math.max(0, Math.trunc(total));
  if (t <= h) return { from: 0, to: t, hiddenAbove: 0, hiddenBelow: 0 };
  const sel = Math.max(0, Math.min(Math.trunc(selected), t - 1));
  // 第一屏不滚（越靠上越不该跳）；之后只在选中项越过下边界时挪一格
  const from = sel < h ? 0 : Math.max(0, Math.min(sel - h + 1, t - h));
  const to = from + h;
  return { from, to, hiddenAbove: from, hiddenBelow: t - to };
}

/** 标签与说明之间至少留几个空格（也是说明列的基准：窗口内最宽标签 + 它）。 */
export const MENU_GAP = 2;

/**
 * 说明列的起始列（**相对标签起点**）：窗口内最宽标签 + `MENU_GAP`。
 *
 * 口径与 `ui/ace_menu.desc_column` **完全相同**（前后端各一份实现，由
 * `test/shell-parity.test.ts` 的 **R-6** 对着真 Python 渲染结果对拍）。
 *
 * 取**窗口内**而不是全表：滚到底部时全表最长的那个已经滚出去了，照它对齐会在左边
 * 留一大片空白。按**显示列**算而不是码点 —— 候选里一旦混进中文标签，
 * 按 `.length` 对齐必然歪。
 */
export function labelColumn(labels: string[]): number {
  return labels.reduce((m, l) => Math.max(m, displayWidth(l)), 0) + MENU_GAP;
}

/**
 * 底部提示行的 i18n 键 —— **按菜单类型选**。
 *
 * 复用 Python 侧已有的 `menu_hint_command` / `menu_hint_mention` / `menu_hint_arg`
 * 三个键，不另发明一套：那三句里已经写清了各自的操作口径（比如命令菜单那句
 * 明确说了"打全的命令一次回车就跑"），新写一句只会与它漂。
 */
export function menuHintKey(state: MenuState): string {
  if (state.kind === '/') return 'menu_hint_command';
  if (state.kind.startsWith('@')) return 'menu_hint_mention';
  return 'menu_hint_arg'; // 参数菜单（kind 是 "/cmd " 形式）
}

/** 把选中候选填进输入串（替换 `span`）—— 回车/Tab 的语义就在这一处。 */
export function acceptedText(state: MenuState, text: string): string {
  const cur = state.items[Math.min(state.selected, Math.max(0, state.items.length - 1))];
  if (!cur) return text;
  const [start, end] = state.span;
  return text.slice(0, start) + cur.insert + text.slice(end);
}
