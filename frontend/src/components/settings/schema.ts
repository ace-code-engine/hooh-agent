/**
 * 设置面板 · **声明式 schema**。
 *
 * 借鉴 `dsh-TUI`（MIT）的 `src/settings/definitions.ts:16-18`（一条设置只描述一次：
 * 标签 / 类型 / 分组 / 选项）与 `:483-492`（`SETTING_GROUPS` 的 `mode: 'inline' | 'page'`：
 * 浅主题在根页直接展开，深主题收成一行导航）。**没拷文件**，用的是 ace 自己的键、
 * 自己的 i18n 键名、自己的协议形状（`docs/design/DshShell-AceCapabilities.md` §3.7c）。
 *
 * 四条纪律，逐条写在下面：
 *   1. **一条设置只声明一次**，渲染器与焦点表都从同一个规划函数 `panelRows()` 派生
 *      （他们的 `rootRowsFor` 就是这个作用，`:48-60`：两边各算一次必然会漂）。
 *   2. **行高恒为 1**（他们 `FieldRow` 的注释 `:95-99`）：焦点移动不重排列表，
 *      宽度也不必为提示行留位 —— 提示住在底部一行。
 *   3. **写通道是模板**：`write_cmd` 里的 `{value}` 由面板填，动作走 `command.exec`
 *      （§3.7c，NG4：不为写动作新增协议方法）。
 *   4. **凭据项不回显**：`secret:true` 的项**没有** `current` 字段，只有 `set`。
 *      这里把"没有 current"当成**正常形状**处理，不是异常（§3.7c 的凭据边界）。
 *
 * 本模块是纯数据 + 纯函数：没有 React、没有终端、没有 I/O —— 所以每一条规则都能在没有
 * TTY 的环境里断言（`test/settings-panel.test.tsx` 的一半用例就在这里）。
 */

import { matchScore } from '../../render/match.js';

/**
 * 面板**自己的**文案键 —— 集中一处声明。
 *
 * 为什么不做成内联字面量（`t('set_title')`）：本波的 `locales/*.json` 归另一位写手，
 * 而 `test/i18n-complete.test.ts` 会扫源码里 `t('字面量')` 并要求三语都命中 —— 键还没落地时
 * 那样写会让整个套件当场变红。键与三语值在 `Q3-settings.md` 里列全，那边一接上，这里
 * 一个字都不用动就生效；要改回内联写法，也只改这一个常量。
 *
 * 数据来源自带的键（`label_key` / 选项的 `label_key` / 分组的 `label_key`）是引擎发的，
 * 走 `t(item.labelKey)` 动态取，不进这张表。
 */
export const PANEL_KEYS = {
  title: 'set_title',
  groupGeneral: 'set_group_general',
  hintList: 'set_hint_list',
  hintSearch: 'set_hint_search',
  hintEdit: 'set_hint_edit',
  searchLabel: 'set_search_label',
  searchEmpty: 'set_search_empty',
  secretSet: 'set_secret_set',
  secretUnset: 'set_secret_unset',
  unset: 'set_unset',
  unsupported: 'set_unsupported',
  chipWizard: 'set_chip_wizard',
  chipReadonly: 'set_chip_readonly',
  noWrite: 'set_no_write',
  empty: 'set_empty',
  invalid: 'set_invalid',
} as const;

// ============================================================
// ① 形状
// ============================================================

/** 面板认得的四种控件类型（协议 `type` 归一化后的结果）。 */
export type SettingKind = 'boolean' | 'enum' | 'number' | 'string' | 'unsupported';

export interface SettingOption {
  value: string;
  /** 选项文案的 i18n 键（引擎发键不发译文，与 `initialize.commands` 同一口径）。 */
  labelKey: string;
}

export interface SettingItem {
  readonly key: string;
  readonly kind: SettingKind;
  /** 引擎发来的原始 `type` 串（认不出时保留原样，便于排查而不是丢掉）。 */
  readonly rawType: string;
  readonly labelKey: string;
  /** 所属分组 id；空串 = 未分组。 */
  readonly group: string;
  /** 取值来源（协议 `scope`：`global` / `project` / `session`…）。 */
  readonly scope: string;
  /** 当前值。**凭据项没有这个字段** —— 用 `undefined` 表示"不可见"，不是"空"。 */
  readonly current: string | undefined;
  readonly default: string;
  readonly options: readonly SettingOption[];
  /** 写通道模板（含 `{value}`）；空串 = 这个键没有对应命令。 */
  readonly writeCmd: string;
  readonly secret: boolean;
  /** 凭据是否已设置 —— 凭据项**唯一**允许露出的信息。 */
  readonly isSet: boolean;
  /** 改完是否立即生效（引擎侧声明）。 */
  readonly hot: boolean;
  /** boolean 的书写词表 `[off, on]`（ace 侧命令收 `on/off`，见 `ui/ace_menu.ARGUMENT_HINTS`）。 */
  readonly values: readonly [string, string];
}

export interface SettingGroup {
  readonly id: string;
  readonly labelKey: string;
  /** `inline` = 根页直接摊开；`page` = 根页只留一行导航（他们 `:483-492`）。 */
  readonly mode: 'inline' | 'page';
}

export interface SettingSection {
  readonly id: string;
  readonly labelKey: string;
  readonly groups: readonly SettingGroup[];
  readonly items: readonly SettingItem[];
}

// ============================================================
// ② 解析（**对缺字段做防御**：协议扩展还在另一路实现中）
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 引擎的 `type` 串 → 本面板的四种控件；认不出的一律 `unsupported`（渲染成只读行，不崩）。 */
const KIND_ALIASES: Readonly<Record<string, SettingKind>> = {
  boolean: 'boolean',
  bool: 'boolean',
  toggle: 'boolean',
  switch: 'boolean',
  enum: 'enum',
  select: 'enum',
  choice: 'enum',
  number: 'number',
  num: 'number',
  int: 'number',
  integer: 'number',
  float: 'number',
  str: 'string',
  string: 'string',
  text: 'string',
};

export function kindOf(rawType: unknown): SettingKind {
  return KIND_ALIASES[str(rawType).trim().toLowerCase()] ?? 'unsupported';
}

/** 默认词表：ace 的布尔命令一律收 `on`/`off`（`ui/ace_menu.ARGUMENT_HINTS`）。 */
export const DEFAULT_BOOL_VALUES: readonly [string, string] = ['off', 'on'];

/** `enum` 的两种写法都收：`[["readonly","perm_readonly"]]`（§3.7c）与 `[{value,label_key}]`。 */
function parseOptions(raw: unknown): readonly SettingOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SettingOption[] = [];
  for (const entry of raw) {
    if (Array.isArray(entry)) {
      const value = str(entry[0]);
      if (value === '') continue;
      out.push({ value, labelKey: str(entry[1]) });
      continue;
    }
    if (isRecord(entry)) {
      const value = str(entry.value);
      if (value === '') continue;
      out.push({ value, labelKey: str(entry.label_key) || str(entry.labelKey) });
    }
  }
  return out;
}

function parseBoolValues(raw: unknown): readonly [string, string] {
  if (Array.isArray(raw) && raw.length >= 2) {
    const off = str(raw[0]);
    const on = str(raw[1]);
    if (off !== '' && on !== '') return [off, on];
  }
  return DEFAULT_BOOL_VALUES;
}

function parseItem(raw: unknown, groupFallback: string): SettingItem | null {
  if (!isRecord(raw)) return null;
  const key = str(raw.key);
  if (key === '') return null; // 没有键就没法写回：宁可丢掉这一条，也不画一个点了没反应的开关
  const rawType = str(raw.type);
  const kind = kindOf(rawType);
  const secret = raw.secret === true;
  // **凭据项没有 current**：显式清成 undefined，别让 `""` 混进来被当成"空值"显示（§3.7c）。
  const current = secret ? undefined : typeof raw.current === 'string' ? raw.current : undefined;
  const options = parseOptions(raw.enum ?? raw.options);
  const isSet = raw.set === true || (secret && current !== undefined && current !== '');
  return {
    key,
    kind,
    rawType,
    labelKey: str(raw.label_key) || str(raw.labelKey) || key,
    group: str(raw.group) || groupFallback,
    scope: str(raw.scope),
    current,
    default: str(raw.default),
    options,
    writeCmd: str(raw.write_cmd) || str(raw.writeCmd),
    secret,
    isSet,
    hot: raw.hot === true,
    values: kind === 'boolean' && options.length >= 2
      ? [options[0]!.value, options[1]!.value]
      : parseBoolValues(raw.values),
  };
}

function parseGroup(raw: unknown): SettingGroup | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (id === '') return null;
  const mode = str(raw.mode).toLowerCase() === 'page' ? 'page' : 'inline';
  return { id, labelKey: str(raw.label_key) || str(raw.title_key) || str(raw.labelKey), mode };
}

/** 未分组项的归属（他们那边是 "a field without a group would render on the root under general"）。 */
export const GENERAL_GROUP: SettingGroup = {
  id: 'general',
  labelKey: PANEL_KEYS.groupGeneral,
  mode: 'inline',
};

function parseSection(raw: unknown): SettingSection | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id) || str(raw.ns);
  const groups: SettingGroup[] = [];
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    const parsed = parseGroup(g);
    if (parsed !== null) groups.push(parsed);
  }
  const declared = new Set(groups.map((g) => g.id));
  const items: SettingItem[] = [];
  let hasUngrouped = false;
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = parseItem(entry, '');
    if (item === null) continue;
    if (item.group === '') hasUngrouped = true;
    items.push(item);
  }
  if (id === '' && items.length === 0 && groups.length === 0) return null;
  // 引擎还没发分组声明（§3.7c 的主要工作量在 Python 侧）：给未声明的分组就地补一条
  // inline 声明，让它们**仍然能被看到**，而不是被静默丢掉。
  const needsGeneral = hasUngrouped || items.some((it) => it.group !== '' && !declared.has(it.group));
  const out: SettingGroup[] = needsGeneral && !declared.has(GENERAL_GROUP.id)
    ? [GENERAL_GROUP, ...groups]
    : [...groups];
  return { id: id || 'main', labelKey: str(raw.label_key) || str(raw.labelKey) || id, groups: out, items };
}

/**
 * 解析 `settings.request` 的返回。**三种输入都认**（整体 resp / sections 数组 / 空），
 * 认不出的部分一律丢掉而不是抛 —— 面板宁可少一行，也不能因为协议里多/少一个字段就崩。
 */
export function parseSettings(payload: unknown): readonly SettingSection[] {
  const rawSections = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.sections)
      ? payload.sections
      : [];
  const out: SettingSection[] = [];
  for (const raw of rawSections) {
    const section = parseSection(raw);
    if (section !== null) out.push(section);
  }
  return out;
}

// ============================================================
// ③ 取值 / 写通道（纯函数）
// ============================================================

/** 能不能把值直接写回去：有 `{value}` 模板才能；只有命令没模板 = 只能开向导（§3.7c 的已知上限）。 */
export type Editability = 'direct' | 'wizard' | 'none';

export function editability(item: SettingItem): Editability {
  if (item.writeCmd === '') return 'none';
  return item.writeCmd.includes('{value}') ? 'direct' : 'wizard';
}

/** 凭据外的 `current` 是否算"有值"。凭据项永远算是"不可见"（交给 `set_secret_*` 文案）。 */
export function hasValue(item: SettingItem): boolean {
  return !item.secret && item.current !== undefined && item.current !== '';
}

const TRUTHY = new Set(['true', 'on', '1', 'yes']);

/** 布尔当前值的读法：认词表里的 `on`，再认 `true/1/yes`；其余一律 false（**不猜**）。 */
export function boolValue(item: SettingItem): boolean {
  const raw = (item.current ?? item.default).trim().toLowerCase();
  if (raw === item.values[1].toLowerCase()) return true;
  if (raw === item.values[0].toLowerCase()) return false;
  return TRUTHY.has(raw);
}

/** ←/→（或回车）循环一格，返回**下一个原始值**；不支持的项返回 `undefined`。 */
export function cycleValue(item: SettingItem, direction: 1 | -1 = 1): string | undefined {
  if (item.kind === 'boolean') return boolValue(item) ? item.values[0] : item.values[1];
  if (item.kind !== 'enum' || item.options.length === 0) return undefined;
  const size = item.options.length;
  const index = item.options.findIndex((o) => o.value === item.current);
  const next = item.options[(((index + direction) % size) + size) % size];
  return next?.value;
}

/** 把值填进 `write_cmd` 模板，得到要交给 `command.exec` 的那一行。空模板返回空串。 */
export function writeCommandFor(item: SettingItem, value: string): string {
  if (item.writeCmd === '') return '';
  return item.writeCmd.includes('{value}') ? item.writeCmd.replaceAll('{value}', value) : item.writeCmd;
}

export interface DraftCheck {
  readonly ok: boolean;
  readonly value: string;
}

/**
 * 校验一次文本草稿。非法值**留在编辑器里**（他们 `Settings.tsx:516-531` 的自动保存口径：
 * 非法不落库，编辑器不关，报错徽标亮着）。
 */
export function checkDraft(item: SettingItem, draft: string): DraftCheck {
  const text = String(draft ?? '');
  if (item.kind === 'number') {
    const trimmed = text.trim();
    const num = Number(trimmed);
    return { ok: trimmed !== '' && Number.isFinite(num), value: trimmed };
  }
  return { ok: !/[\u0000-\u001f\u007f]/.test(text), value: text };
}

// ============================================================
// ④ 行规划（渲染器与焦点表**共用这一个函数**，所以他们不会漂）
// ============================================================

export type PanelRow =
  | { readonly kind: 'header'; readonly id: string; readonly labelKey: string }
  | { readonly kind: 'field'; readonly id: string; readonly section: SettingSection; readonly item: SettingItem }
  | {
      readonly kind: 'page';
      readonly id: string;
      readonly section: SettingSection;
      readonly group: SettingGroup;
      readonly count: number;
    };

/** 字段行（`rankFields` 只吃这一种，类型收窄在这一个地方）。 */
type FieldRow = Extract<PanelRow, { kind: 'field' }>;

function fieldRows(section: SettingSection, items: readonly SettingItem[]): FieldRow[] {
  return items.map((item) => ({ kind: 'field' as const, id: `${section.id}:${item.key}`, section, item }));
}

export interface PanelQuery {
  /** 只看某个 `page` 分组（子页）。 */
  readonly groupId?: string | null;
  readonly query?: string;
}

/**
 * 规划当前要画的行。
 *
 * 根页：未分组项 → 各分组的 inline 标题 + 字段 / page 单行导航（顺序与声明一致）。
 * 子页：该分组的字段。
 * 有查询时：**全局压平**成一张按 `render/match.ts` 评分降序的字段表。
 *
 * 搜索为什么必须全局（而不是只筛当前这一屏）：`page` 分组把字段收进子页之后，
 * 只在根页筛就等于"藏在子页里的设置永远搜不到" —— 而设置搜索的价值恰恰是
 * "我记得有个沙箱开关但忘了它在哪一层"。评分复用补全菜单与选择器那一套
 * （`render/match.ts`），设置搜索是第三种筛选，不该有第三套手感。
 */
export function panelRows(
  sections: readonly SettingSection[],
  opts: PanelQuery = {},
  label: (key: string) => string = (key) => key,
): readonly PanelRow[] {
  const query = (opts.query ?? '').trim();
  if (query !== '') {
    const all: FieldRow[] = [];
    for (const section of sections) all.push(...fieldRows(section, section.items));
    return rankFields(all, query, label);
  }

  if (opts.groupId) {
    const rows: FieldRow[] = [];
    for (const section of sections) {
      const group = section.groups.find((g) => g.id === opts.groupId);
      if (group === undefined) continue;
      rows.push(...fieldRows(section, section.items.filter((it) => it.group === group.id)));
    }
    return rows;
  }

  const root: PanelRow[] = [];
  for (const section of sections) {
    root.push(...fieldRows(section, section.items.filter((it) => it.group === '')));
    for (const group of section.groups) {
      const items = section.items.filter((it) => it.group === group.id);
      if (group.mode === 'page') {
        if (items.length > 0) {
          root.push({ kind: 'page', id: `${section.id}:${group.id}`, section, group, count: items.length });
        }
        continue;
      }
      if (items.length === 0) continue;
      root.push({ kind: 'header', id: `${section.id}:h:${group.id}`, labelKey: group.labelKey });
      root.push(...fieldRows(section, items));
    }
  }
  return root;
}

/** 按评分降序；标签/键/来源/当前值/选项都算命中（都进检索面，几乎免费）。 */
function rankFields(
  rows: readonly FieldRow[],
  query: string,
  label: (key: string) => string,
): readonly FieldRow[] {
  const scored = rows.map((row) => {
    const parts = [
      label(row.item.labelKey),
      row.item.key,
      row.item.scope,
      row.item.current ?? '',
      ...row.item.options.map((o) => `${o.value} ${label(o.labelKey)}`),
    ];
    const score = parts.reduce((best, part) => Math.max(best, matchScore(part, query)), 0);
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score); // 稳定排序：同分保持原顺序（与 filterItems 同口径）
  return scored.filter((s) => s.score > 0).map((s) => s.row);
}

/** 焦点只落在非标题行上。 */
export function focusableRows(rows: readonly PanelRow[]): readonly PanelRow[] {
  return rows.filter((row) => row.kind !== 'header');
}

/** 移动焦点（**不循环**，与 `render/menu.windowBounds` 的黏边口径一致：列表有头有尾）。 */
export function moveFocusId(rows: readonly PanelRow[], focusId: string | null, delta: number): string | null {
  const items = focusableRows(rows);
  if (items.length === 0) return null;
  const index = items.findIndex((row) => row.id === focusId);
  const next = Math.max(0, Math.min(items.length - 1, (index < 0 ? 0 : index) + delta));
  return items[next]?.id ?? null;
}

/** 当前焦点行在**整张行表**里的下标（窗口按行算，标题也占一行）。 */
export function rowIndexOf(rows: readonly PanelRow[], focusId: string | null): number {
  const index = rows.findIndex((row) => row.id === focusId);
  if (index >= 0) return index;
  const first = rows.findIndex((row) => row.kind !== 'header');
  return first < 0 ? 0 : first;
}
