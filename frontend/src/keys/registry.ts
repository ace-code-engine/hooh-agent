/**
 * 键位注册表 —— 借鉴 dsh-TUI（MIT，`src/utils/keymap.ts`）的 action → combos 设计，
 * 动作名、默认键与 i18n 键换成 ace 自己的一份（动作来源：`ui/ace_keys.py` 的 `APP_KEYMAP`）。
 *
 * 本模块**只做模型**：不碰 `App.tsx` / `Input.tsx` 的 `useInput`，不读也不写配置文件，
 * 因此它是一块纯数据 + 纯函数 —— 每一条规则都能在没有终端的环境里断言。
 *
 * 借来的四件事（行号对到他们的 `keymap.ts`）：
 *
 *   1. **action 声明**：稳定 id + `defaults[]` + i18n 键（他们 `:206-251`）。默认键的
 *      **第一项**是展示用的规范形式；i18n 键只发键名不发译文（与仓库既有口径一致）。
 *   2. **平台别名**：`ctrl` 在 mac 上同时认 Cmd（他们读 ink 的 `super`，`:166-183`）；
 *      `exactPrimary` 让某个 action 退出别名（`:212-215`、`:253-256`）。
 *   3. **固定保留集**：终端/外壳的保命键与行编辑键永远不许被用户改掉（他们 `:372-410`）。
 *      撞上保留键要**当场拒绝并说明原因**，不是静默忽略。
 *   4. **冲突检测**：两个 action 抢同一个键要能报出**双方**（他们 `:412-438`）。
 *
 * 三处刻意与借鉴对象不同（都在下面的注释里就地说明）：`cmd`/`super` 写法并入主修饰键；
 * 保留集条目自带原因码（拒绝时能说出这是哪个动作的键）；校验结果是结构化的
 * （code + message + i18nKey + 冲突双方），而不是一个布尔。
 */

// ============================================================
// ① 组合键语法
// ============================================================

/** 键位标志：与 `vendor/dsh-ink/kernel.d.ts` 的 `Key` 兼容（只取本模块用到的子集）。
 *  注意两个名字的坑：ink 的 `meta` 表示 **Alt**（转义前缀那个），`super` 才是 macOS 的 Cmd。 */
export interface KeyFlags {
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
  shift?: boolean;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

/** 命名键在 `Key` 对象上的标志名（字符键不走这里，走 `input`）。 */
export type NamedKey =
  | 'return'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'upArrow'
  | 'downArrow'
  | 'leftArrow'
  | 'rightArrow'
  | 'home'
  | 'end'
  | 'pageUp'
  | 'pageDown';

/** 解析后的组合键（`ctrl+shift+p` 这种）。字符键用 `char`，命名键用 `named`，二者互斥。 */
export interface ParsedCombo {
  readonly raw: string;
  readonly ctrl: boolean;
  /** ink 的 Alt（在 `Key` 上是 `meta`）。 */
  readonly alt: boolean;
  readonly shift: boolean;
  readonly named?: NamedKey;
  /** 要与 ink 的 `input` 比对的字符（已小写）。 */
  readonly char?: string;
}

const NAMED_KEYS: Readonly<Record<string, NamedKey>> = {
  enter: 'return',
  return: 'return',
  esc: 'escape',
  escape: 'escape',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  up: 'upArrow',
  down: 'downArrow',
  left: 'leftArrow',
  right: 'rightArrow',
  home: 'home',
  end: 'end',
  pageup: 'pageUp',
  pgup: 'pageUp',
  pagedown: 'pageDown',
  pgdn: 'pageDown',
};

/**
 * 修饰键写法 → 逻辑修饰键。
 *
 * 与借鉴对象的第一处差异：他们只认 `ctrl`/`alt`/`shift`（+`option`/`meta` 当 alt），
 * 写 `cmd+c` 会解析失败；而失败后 `canonicalComboString` 会把它原样小写返回，
 * 于是 `cmd+c` 既不在保留集里、又永远匹配不上任何按键 —— 一个**静默的死键位**。
 * 这里把 `cmd`/`command`/`super` 一律并入主修饰键：mac 用户写 `cmd+c` 得到的就是
 * Cmd+C，而 `cmd+c` 规范化成 `ctrl+c` 后会**正确撞上保命键**被拒。
 */
const MODIFIER_ALIASES: Readonly<Record<string, 'ctrl' | 'alt' | 'shift'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  super: 'ctrl',
  alt: 'alt',
  meta: 'alt',
  option: 'alt',
  shift: 'shift',
};

/**
 * 解析 `ctrl+shift+p` 这类组合键；写法有问题一律返回 `undefined`。
 *
 * 三条纪律（与借鉴对象 `:79-121` 一致）：
 *   - **裸键是输入，不是快捷键**：必须有 ctrl 或 alt，否则 `a` 这种会被当成快捷键，
 *     结果是"打字打不出 a"；
 *   - `escape` 的组合键一律非法：ace 的输入层在别处就把 Esc 吃掉了（`Input.tsx` 的
 *     两段式），`ctrl+escape` 永远不会是一个无歧义的信号；
 *   - 同一个修饰键写两遍（`ctrl+ctrl+k`）、同时给两个键（`ctrl+a+b`）都算写错。
 */
export function parseCombo(raw: string): ParsedCombo | undefined {
  const parts = String(raw ?? '')
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return undefined;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let named: NamedKey | undefined;
  let char: string | undefined;
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part];
    if (mod === 'ctrl') {
      if (ctrl) return undefined;
      ctrl = true;
    } else if (mod === 'alt') {
      if (alt) return undefined;
      alt = true;
    } else if (mod === 'shift') {
      if (shift) return undefined;
      shift = true;
    } else if (part === 'space') {
      if (char !== undefined || named !== undefined) return undefined;
      char = ' ';
    } else if (part in NAMED_KEYS) {
      if (char !== undefined || named !== undefined) return undefined;
      named = NAMED_KEYS[part];
    } else if ([...part].length === 1) {
      if (char !== undefined || named !== undefined) return undefined;
      char = part;
    } else {
      return undefined;
    }
  }
  if (char === undefined && named === undefined) return undefined;
  // 没有主修饰键或 alt 就不是快捷键，是打字/导航（见上面第 1 条纪律）。
  if (!ctrl && !alt) return undefined;
  if (named === 'escape') return undefined;
  return {
    raw: parts.join('+'),
    ctrl,
    alt,
    shift,
    ...(named === undefined ? {} : { named }),
    ...(char === undefined ? {} : { char }),
  };
}

/** 规范化形式（去重/保留集/冲突判定都用它）：修饰键排序 + 键名放最后。 */
export function canonicalCombo(combo: ParsedCombo): string {
  const mods = [combo.ctrl ? 'ctrl' : '', combo.alt ? 'alt' : '', combo.shift ? 'shift' : '']
    .filter((part) => part !== '')
    .sort();
  return [...mods, combo.named === undefined ? (combo.char ?? '') : String(combo.named)].join('+');
}

/**
 * 把一个用户写法的组合键规范化。**解析不了的按小写原样返回**（借鉴对象 `:131-137`）——
 * 保留集里必须能装下语法自己拒收的键：`escape`、`tab`、`shift+tab` 都不是合法"快捷键"
 * 写法（裸键 / 只有 shift），但它们确实是**绑着的键**，不能被用户抢走。
 */
export function canonicalComboString(raw: string): string {
  const combo = parseCombo(raw);
  return combo === undefined ? String(raw ?? '').toLowerCase() : canonicalCombo(combo);
}

/** 按分隔符拆一串草稿（设置页输入框里就是 `ctrl+k, alt+k` 这种形状）。 */
export function splitComboText(text: string | readonly string[]): string[] {
  const entries = typeof text === 'string' ? [text] : [...text];
  return entries
    .flatMap((entry) => String(entry ?? '').split(/[,;]/))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
};

/** 展示用写法（`ctrl+shift+e` → `Ctrl+Shift+E`）；提示文案必须跟着重映射走。 */
export function comboDisplay(raw: string): string {
  return String(raw ?? '')
    .split('+')
    .map((token) => {
      const lower = token.toLowerCase();
      const mod = MODIFIER_LABELS[lower];
      if (mod !== undefined) return mod;
      if (lower === 'pgup') return 'PgUp';
      if (lower === 'pgdn') return 'PgDn';
      return token.length === 1 ? token.toUpperCase() : token[0]!.toUpperCase() + token.slice(1);
    })
    .join('+');
}

/** 这台机器上主修饰键是不是 Cmd。做成函数（不是常量）方便测试注入两种极性的极性。 */
export function defaultPlatformAlias(): boolean {
  return typeof process !== 'undefined' && process.platform === 'darwin';
}

// ============================================================
// ② action 声明
// ============================================================

/** 可被用户重映射的 action 名。加一个动作 = 加一条数据，别在组件里写 if。 */
export type KeyActionId =
  | 'tasks'
  | 'expand'
  | 'toggle_board'
  | 'external_editor'
  | 'clear_transcript'
  | 'stash_prompt'
  | 'search_history'
  | 'find'
  | 'model_pick'
  | 'new_chat'
  | 'history_pick'
  | 'effort'
  | 'net_toggle'
  | 'lang_pick'
  | 'home'
  | 'toggle_thinking'
  | 'undo';

export interface KeyActionSpec {
  readonly id: KeyActionId;
  /** 默认键位；**第一项**是展示/提示用的规范形式。 */
  readonly defaults: readonly string[];
  /**
   * 这个动作的说明 i18n 键（不在这里发译文）。
   *
   * 只用**已存在**于 `locales/*.json` 的键。注意别照抄 `ui/ace_keys.py` 的 desc_key ——
   * 它引用了 `key_del_word` / `key_del_line` / `key_word_left` / `key_word_right` 四个
   * **不存在**的键（Python 侧没有前端这道 i18n 守卫，前端有）。
   */
  readonly i18nKey: string;
  /**
   * 退出 mac 上的 ctrl↔Cmd 别名：这个动作只认真 Ctrl（借鉴对象 `:212-215`、`:244-246`）。
   *
   * 场景就是他们那个：**Cmd+Z 是 macOS 自己的撤销**（终端、输入法、系统都先于应用拿它），
   * 草稿级撤销套上别名等于让应用去抢系统快捷键。ace 侧对应动作（词级 undo）还没落地，
   * 先按他们口径声明 —— 关键帧是 `cmd+z` 与 `ctrl+z` 必须只剩真 Ctrl 那一个触发。
   */
  readonly exactPrimary?: boolean;
}

/**
 * 注册表本体：默认键位 = ace 今天实际的绑定，不做发明。
 *
 * **两处与 `ui/ace_keys.py:226-286` 的不同（Python 那边是真冲突，照抄会把 bug 抄过来）**：
 *   - 它把 `alt+t` 同时给了 `effort` 与 `toggle_thinking`（`:260`、`:265`）—— 这里只留
 *     `effort`，thinking 改用它同一段里重复写过的 `alt+k`（`:264` 原本归 tasks，
 *     而 tasks 已有 `ctrl+t`）；
 *   - `ctrl+e` 在它那儿既是"外部编辑器"又是 `expandEditor`（`:282`、`:280`）—— 这里编辑器
 *     保持 `ctrl+g`（`:256`），`ctrl+e` 不进注册表。
 */
export const KEY_ACTIONS: readonly KeyActionSpec[] = [
  { id: 'tasks', defaults: ['ctrl+t'], i18nKey: 'key_tasks' },
  { id: 'expand', defaults: ['ctrl+o'], i18nKey: 'key_expand' },
  { id: 'toggle_board', defaults: ['ctrl+b'], i18nKey: 'key_board' },
  { id: 'external_editor', defaults: ['ctrl+g'], i18nKey: 'key_editor' },
  { id: 'clear_transcript', defaults: ['ctrl+l'], i18nKey: 'key_clear' },
  { id: 'stash_prompt', defaults: ['ctrl+s'], i18nKey: 'key_stash' },
  { id: 'search_history', defaults: ['ctrl+r'], i18nKey: 'key_search' },
  { id: 'find', defaults: ['ctrl+f'], i18nKey: 'key_find' },
  { id: 'model_pick', defaults: ['alt+m'], i18nKey: 'key_model' },
  { id: 'new_chat', defaults: ['alt+n'], i18nKey: 'key_new' },
  { id: 'history_pick', defaults: ['alt+h'], i18nKey: 'key_history_pick' },
  { id: 'effort', defaults: ['alt+t'], i18nKey: 'key_effort' },
  { id: 'net_toggle', defaults: ['alt+w'], i18nKey: 'key_net' },
  { id: 'lang_pick', defaults: ['alt+l'], i18nKey: 'key_lang' },
  { id: 'home', defaults: ['alt+1'], i18nKey: 'key_home' },
  { id: 'toggle_thinking', defaults: ['alt+k'], i18nKey: 'key_thinking' },
  { id: 'undo', defaults: ['ctrl+z'], i18nKey: 'key_undo', exactPrimary: true },
];

export const KEY_ACTION_IDS: readonly KeyActionId[] = KEY_ACTIONS.map((spec) => spec.id);

const ACTION_BY_ID: ReadonlyMap<string, KeyActionSpec> = new Map(KEY_ACTIONS.map((spec) => [spec.id, spec]));

/** 查一个 action 的声明；**未知 id 返回 undefined，不抛**（配置是外部数据）。 */
export function actionSpec(id: string): KeyActionSpec | undefined {
  return ACTION_BY_ID.get(String(id));
}

/** 该 action 是否退出平台别名（`exactPrimary`）。未知 id → false。 */
export function isExactPrimary(id: string): boolean {
  return actionSpec(id)?.exactPrimary === true;
}

const DEFAULT_COMBOS: ReadonlyMap<string, readonly ParsedCombo[]> = new Map(
  KEY_ACTIONS.map((spec) => [
    spec.id,
    spec.defaults.map(parseCombo).filter((combo): combo is ParsedCombo => combo !== undefined),
  ]),
);

// ============================================================
// ③ 固定保留集
// ============================================================

/** 保留原因：保命键 / 行编辑键 / 结构性导航键。拒绝时要说清楚是哪一类。 */
export type ReservedReason = 'lifeline' | 'editing' | 'structural';

export interface ReservedBinding {
  /** 用户写的那个键（规范化比对，写法可以随便）。 */
  readonly combo: string;
  readonly reason: ReservedReason;
  /** 它保护的动作名（拒绝信息里要报出来，不能只说"被占了"）。 */
  readonly action: string;
  /** 这个动作的说明 i18n 键（可为**建议新增**的键名，见报告）。 */
  readonly i18nKey: string;
}

/**
 * 用户**永远**改不掉的键（借鉴对象 `:372-398`），换成 ace 的实况：
 * 保命键来自 `ui/ace_keys.py:33`，行编辑/结构键来自 `Input.tsx:244-276` 与
 * `scroll-box.tsx:96-104`（那里裸按 ↑↓/PgUp/PgDn 就滚，所以任何带修饰键的箭头
 * 也不能被抢走，否则一个键会同时触发两件事）。
 */
export const RESERVED_BINDINGS: readonly ReservedBinding[] = [
  { combo: 'ctrl+c', reason: 'lifeline', action: 'interrupt', i18nKey: 'key_interrupt' },
  { combo: 'ctrl+d', reason: 'lifeline', action: 'quit_if_empty', i18nKey: 'key_quit' },
  { combo: 'ctrl+j', reason: 'lifeline', action: 'newline', i18nKey: 'key_newline' },
  { combo: 'alt+enter', reason: 'lifeline', action: 'newline', i18nKey: 'key_newline' },
  { combo: 'ctrl+enter', reason: 'lifeline', action: 'newline', i18nKey: 'key_newline' },
  { combo: 'escape', reason: 'lifeline', action: 'cancel', i18nKey: 'key_cancel' },
  { combo: 'tab', reason: 'structural', action: 'complete', i18nKey: 'key_complete' },
  { combo: 'shift+tab', reason: 'structural', action: 'cycle_permission', i18nKey: 'key_cycle_perm' },
  { combo: 'ctrl+a', reason: 'editing', action: 'line_start', i18nKey: 'key_line_start' },
  { combo: 'ctrl+e', reason: 'editing', action: 'line_end', i18nKey: 'key_line_end' },
  { combo: 'ctrl+u', reason: 'editing', action: 'delete_to_start', i18nKey: 'key_del_line' },
  { combo: 'ctrl+k', reason: 'editing', action: 'delete_to_end', i18nKey: 'key_del_line_end' },
  { combo: 'ctrl+w', reason: 'editing', action: 'delete_word_back', i18nKey: 'key_del_word' },
  { combo: 'ctrl+left', reason: 'editing', action: 'word_left', i18nKey: 'key_word_left' },
  { combo: 'ctrl+right', reason: 'editing', action: 'word_right', i18nKey: 'key_word_right' },
  { combo: 'ctrl+up', reason: 'structural', action: 'scroll_up', i18nKey: 'key_scroll' },
  { combo: 'ctrl+down', reason: 'structural', action: 'scroll_down', i18nKey: 'key_scroll' },
];

const RESERVED_BY_CANONICAL: ReadonlyMap<string, ReservedBinding> = new Map(
  RESERVED_BINDINGS.map((entry) => [canonicalComboString(entry.combo), entry]),
);

/** 规范化后的保留集（给"插件/自定义键位"那类外部注册方用）。 */
export function reservedCombos(): ReadonlySet<string> {
  return new Set(RESERVED_BY_CANONICAL.keys());
}

/** 查一个用户写法的键是不是保留键；**返回条目本身**，这样拒绝信息能说出原因。 */
export function reservedBinding(raw: string): ReservedBinding | undefined {
  return RESERVED_BY_CANONICAL.get(canonicalComboString(raw));
}

export function isReserved(raw: string): boolean {
  return reservedBinding(raw) !== undefined;
}

// ============================================================
// ④ 冲突检测 + 重映射校验
// ============================================================

export interface KeyConflict {
  /** 规范化后的键。 */
  readonly combo: string;
  /** 抢这个键的 action（至少两个；按注册表顺序）。 */
  readonly actions: readonly string[];
}

/** 覆盖层：只在内存里，**不落盘**（配置文件读写是下一步）。 */
let overrideCombos: ReadonlyMap<string, readonly ParsedCombo[]> = new Map();

/** 某个 action 当前生效的键（覆盖 > 默认）；未知 id → 空数组，不抛。 */
export function effectiveCombos(id: string): readonly ParsedCombo[] {
  const key = String(id);
  return overrideCombos.get(key) ?? DEFAULT_COMBOS.get(key) ?? [];
}

/** 生效键位的展示串（`Ctrl+K, Alt+K`）—— 提示文案跟着重映射走的关键。 */
export function effectiveComboDisplay(id: string): string {
  return effectiveCombos(id)
    .map((combo) => comboDisplay(combo.raw))
    .join(', ');
}

/** 未覆盖时返回 undefined（与"覆盖成了空"区分开）。 */
export function overrideCombosFor(id: string): readonly ParsedCombo[] | undefined {
  return overrideCombos.get(String(id));
}

/** 某个 action 在"给定的覆盖层"下的键（`findConflicts` 的诊断入参用）。 */
function combosUnder(
  id: string,
  overrides: Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
): readonly ParsedCombo[] {
  const raw = overrides === undefined ? undefined : overrides[id];
  if (raw === undefined) return effectiveCombos(id);
  return splitComboText(raw)
    .map(parseCombo)
    .filter((combo): combo is ParsedCombo => combo !== undefined);
}

/**
 * 找出同一时刻两方（或更多）抢同一个键的组合，**双方都列出来**。
 *
 * 默认表内部必须为空（有测试钉住）。`overrides` 是诊断入参：配置是从文件里手写进来的，
 * 出现"两张表合并后打架"这种既成坏状态时，得有一处能把它指着名字报出来。
 */
export function findConflicts(
  overrides?: Readonly<Record<string, string | readonly string[] | undefined>>,
): readonly KeyConflict[] {
  const owners = new Map<string, string[]>();
  for (const spec of KEY_ACTIONS) {
    for (const combo of combosUnder(spec.id, overrides)) {
      const key = canonicalCombo(combo);
      const list = owners.get(key);
      if (list === undefined) owners.set(key, [spec.id]);
      else if (!list.includes(spec.id)) list.push(spec.id);
    }
  }
  const out: KeyConflict[] = [];
  for (const [combo, actions] of owners) {
    if (actions.length > 1) out.push({ combo, actions });
  }
  return out;
}

export type RebindCode = 'unknown_action' | 'reserved' | 'malformed' | 'conflict';

export interface RebindRejection {
  readonly ok: false;
  readonly code: RebindCode;
  readonly action: string;
  /** 用户写的那个键（原样），拒绝信息里要原样回显。 */
  readonly combo: string;
  /** 给维护者/日志看的英文句子（界面文案走 i18nKey，本模块不发译文）。 */
  readonly message: string;
  /** 界面用的 i18n 键 + 参数（建议新增的键名见报告）。 */
  readonly i18nKey: string;
  readonly params: Readonly<Record<string, string>>;
  /** `conflict` 时的另一方（可能多个）。 */
  readonly conflictsWith?: readonly string[];
  /** `reserved` 时它保护的动作与原因。 */
  readonly reserved?: ReservedBinding;
}

export interface RebindAccepted {
  readonly ok: true;
  readonly action: string;
  /** 规范化后的生效键；空数组 = 撤销覆盖、回到默认。 */
  readonly combos: readonly string[];
}

export type RebindResult = RebindAccepted | RebindRejection;

function reject(
  code: RebindCode,
  action: string,
  combo: string,
  message: string,
  i18nKey: string,
  params: Record<string, string>,
  extra: { conflictsWith?: readonly string[]; reserved?: ReservedBinding } = {},
): RebindRejection {
  return { ok: false, code, action, combo, message, i18nKey, params, ...extra };
}

/**
 * 校验一次重映射（**纯函数**，不改任何状态）—— 设置页在用户敲键的当下就调它。
 *
 * 顺序是刻意的：**先看保留集，再看写法**。`tab` / `escape` / `shift+tab` 在语法上
 * 不是合法的"快捷键"（裸键 / 只有 shift），用户真去绑它们时想听的是"这是保命键"，
 * 不是"写法不合法"。
 *
 * 空输入 = **撤销覆盖、回到默认**（借鉴对象 `:356-363` 的草稿语义），不是错误。
 *
 * 冲突判定只看"当前生效"的键：把某个键**再写回自己**（默认或当前覆盖）不算冲突 ——
 * 否则 `clear_transcript` 连自己的 `ctrl+l` 都保存不了（借鉴对象 `:418-438` 的 own 集合）。
 */
export function validateRebind(action: string, raw: string | readonly string[]): RebindResult {
  const id = String(action ?? '');
  const spec = actionSpec(id);
  if (spec === undefined) {
    return reject('unknown_action', id, '', `unknown action "${id}"`, 'keys_err_unknown_action', { action: id });
  }
  const combos = splitComboText(raw);
  if (combos.length === 0) return { ok: true, action: id, combos: [] };

  const own = new Set<string>();
  for (const ownRaw of spec.defaults) own.add(canonicalComboString(ownRaw));
  for (const combo of effectiveCombos(id)) own.add(canonicalCombo(combo));

  for (const combo of combos) {
    const reserved = reservedBinding(combo);
    if (reserved !== undefined && !own.has(canonicalComboString(combo))) {
      return reject(
        'reserved',
        id,
        combo,
        `combo ${canonicalComboString(combo)} is reserved (${reserved.reason}, bound to ${reserved.action}); it can never be remapped`,
        'keys_err_reserved',
        { combo: comboDisplay(combo), action: reserved.action, reason: reserved.reason },
        { reserved },
      );
    }
    if (parseCombo(combo) === undefined) {
      return reject(
        'malformed',
        id,
        combo,
        `combo "${combo}" is malformed: needs Ctrl/Alt plus a key, e.g. ctrl+k`,
        'keys_err_malformed',
        { combo: combo },
      );
    }
    const others: string[] = [];
    for (const other of KEY_ACTIONS) {
      if (other.id === id) continue;
      for (const bound of effectiveCombos(other.id)) {
        if (canonicalCombo(bound) === canonicalComboString(combo) && !others.includes(other.id)) others.push(other.id);
      }
    }
    if (others.length > 0) {
      return reject(
        'conflict',
        id,
        combo,
        `combo ${canonicalComboString(combo)} is already bound to ${others.join(', ')}; rebinding ${id} would shadow it`,
        'keys_err_conflict',
        { combo: comboDisplay(combo), others: others.join(', ') },
        { conflictsWith: others },
      );
    }
  }
  return { ok: true, action: id, combos: combos.map((combo) => canonicalComboString(combo)) };
}

/**
 * 应用一批覆盖（来自配置/设置页）。**逐条校验**：
 * 通过的生效，没通过的进 `rejected`（带原因）——绝不静默忽略。
 * 单条出错不影响其它条（借鉴对象是"整条丢弃"，这里更啰嗦一点，因为要给人看原因）。
 */
export function setKeyOverrides(raw: Readonly<Record<string, string | readonly string[] | undefined>>): {
  applied: string[];
  rejected: RebindRejection[];
} {
  const next = new Map(overrideCombos);
  const applied: string[] = [];
  const rejected: RebindRejection[] = [];
  for (const [id, value] of Object.entries(raw ?? {})) {
    if (value === undefined) continue;
    const result = validateRebind(id, value);
    if (!result.ok) {
      rejected.push(result);
      continue;
    }
    if (result.combos.length === 0) next.delete(result.action);
    else {
      next.set(
        result.action,
        result.combos.map(parseCombo).filter((combo): combo is ParsedCombo => combo !== undefined),
      );
    }
    applied.push(result.action);
  }
  overrideCombos = next;
  return { applied, rejected };
}

/** 测试接缝：丢掉所有覆盖。 */
export function resetKeyOverrides(): void {
  overrideCombos = new Map();
}

// ============================================================
// ⑤ 匹配
// ============================================================

export interface MatchOptions {
  /** 主修饰键别名是否生效（默认按 `process.platform`）。注入它 = Linux CI 上也能断言 mac 那一极。 */
  readonly platformAlias?: boolean;
}

/**
 * 这个按键是不是命中了某 action 的**当前**键位（含平台别名，`exactPrimary` 的动作除外）。
 *
 * 三个细节都是踩出来的（借鉴对象 `:166-183`）：
 *   - mac 上 `ctrl+v` 也认 Cmd+V（别名只作用于主修饰键，不改 shift）；
 *   - `alt` 对应 ink 的 `meta` 标志；
 *   - **shift 永远精确匹配**：`ctrl+shift+k` 不许命中 `ctrl+k`，否则一个按键做两件事。
 *
 * 未知 action → `false`（不抛：配置里出现陌生动作名是常态）。
 */
export function matchesAction(id: string, input: string, key: KeyFlags, options: MatchOptions = {}): boolean {
  const spec = actionSpec(id);
  if (spec === undefined) return false;
  const alias = (options.platformAlias ?? defaultPlatformAlias()) && spec.exactPrimary !== true;
  const primary = key.ctrl === true || (alias && key.super === true);
  for (const combo of effectiveCombos(spec.id)) {
    if (combo.ctrl !== primary) continue;
    if (combo.alt !== (key.meta === true)) continue;
    if (combo.shift !== (key.shift === true)) continue;
    if (combo.named !== undefined) {
      if (key[combo.named] !== true) continue;
      return true;
    }
    if (combo.char === undefined) continue;
    if (String(input ?? '').toLowerCase() === combo.char) return true;
  }
  return false;
}

/** 平台别名关掉时的严格匹配（`ctrl+k` 只认真 Ctrl）—— 给"自定义键位/插件"那条通道用。 */
export function matchesActionStrict(id: string, input: string, key: KeyFlags): boolean {
  const spec = actionSpec(id);
  if (spec === undefined) return false;
  if (key.super === true) return false;
  return matchesAction(spec.id, input, key, { platformAlias: false });
}
