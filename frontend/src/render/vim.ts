/**
 * vim 子集：motions / operators / text objects —— 逐条移植自 `ui/ace_vim.py`。
 *
 * ## 为什么必须逐条一致（而不是"做个差不多的"）
 *
 * vim 键位是**肌肉记忆**。用户按 `ciw` 期望删掉光标下的词并进入插入模式；
 * 如果这边把它理解成别的范围，他不会看到一条错误，只会看到**自己刚写的一段被删错**——
 * 而且已经撤不回来了（那边不做撤销栈，这边也没有）。
 * 所以移植完还要跑**差分测试**：同一批 `(文本, 光标, 键序列)` 同时喂给 Python 与 TS，
 * 逐条比 `(文本, 光标, 模式)`。
 *
 * ## 那边刻意不做的（这里同样不做）
 *
 * 撤销栈、寄存器（只留一格给 `p`）、宏、`.` 重复、可视模式、搜索 `/`。
 * 理由写在它文件头：要么需要一整套状态机，要么在"输入一行提示词"这个场景里收益极低。
 *
 * ## 一条最重要的安全口径
 *
 * **失败一律不改文本**，只留 `note`。编辑一行提示词时"悄悄删错东西"比"没生效"坏得多。
 */

export class VimError extends Error {}

/** 词：字母数字下划线一串。与 `ace_vim._WORD` 同。 */
const WORD_RE = /[A-Za-z0-9_]+/y;

/** 成对符号 + 引号（vim 的 text object 语义）。与 `_PAIRS` 逐条相同。 */
export const PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '`': '`',
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
};

function isSpace(ch: string): boolean {
  // Python 的 str.isspace() 覆盖 unicode 空白；这里跟着走，否则 CJK 全角空格会被当普通字符
  return /\s/.test(ch);
}

/** 把文本切成"词"的区间；空白跳过，其余非词字符各算一段。 */
export function wordSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const t = text ?? '';
  let i = 0;
  const n = t.length;
  while (i < n) {
    if (isSpace(t[i]!)) {
      i += 1;
      continue;
    }
    WORD_RE.lastIndex = i;
    const m = WORD_RE.exec(t);
    if (m) {
      spans.push([m.index, m.index + m[0].length]);
      i = m.index + m[0].length;
    } else {
      spans.push([i, i + 1]);
      i += 1;
    }
  }
  return spans;
}

/**
 * 文本对象 → `[start, end)`；找不到返回 `null`（调用方给提示，**不静默删错东西**）。
 *
 * 支持 `iw`/`aw`、`i"`/`a"`（含 `'` 与反引号）、`i(`/`a(`（成对符号）、`ip`/`ap`。
 */
export function textObject(text: string, cursor: number, obj: string): [number, number] | null {
  const o = String(obj ?? '');
  if (!o || o.length < 2) return null;
  const inner = o[0] === 'i';
  const ch = o[1]!;
  const t = text ?? '';
  const n = t.length;
  const cur = Math.max(0, Math.min(Math.trunc(cursor), n));

  if (ch === 'p') return [0, n];

  if (ch === 'w') {
    for (const [s, e] of wordSpans(t)) {
      // 光标在词内，或紧贴在词尾之后（vim 里 `ciw` 停在词尾也该作用在这个词上）
      if ((s <= cur && cur < e) || (cur === e && s <= cur - 1 && cur - 1 < e)) {
        if (inner) return [s, e];
        let end = e;
        while (end < n && isSpace(t[end]!)) end += 1;
        return [s, end];
      }
    }
    return null;
  }

  if (ch in PAIRS) {
    const target = PAIRS[ch]!;
    // 从光标处向两侧找最近的一对（不做多行/嵌套 —— 一行提示词里没有嵌套的必要）
    const left = t.lastIndexOf(ch, cur);
    const right = t.indexOf(target, left < 0 ? cur : left + 1);
    if (left < 0 || right < 0 || right <= left) return null;
    return inner ? [left + 1, right] : [left, right + 1];
  }
  return null;
}

// ---------------------------------------------------------------- motions

export type Motion = (t: string, c: number, n: number) => number;

const mH: Motion = (_t, c, n) => Math.max(0, c - n);
const mL: Motion = (t, c, n) => Math.min(t.length, c + n);
const m0: Motion = () => 0;
const mDollar: Motion = (t) => t.length;

const mW: Motion = (t, c, n) => {
  let pos = c;
  for (let i = 0; i < Math.max(1, n); i++) {
    const starts = wordSpans(t).filter(([s]) => s > pos).map(([s]) => s);
    if (!starts.length) return t.length;
    pos = starts[0]!;
  }
  return pos;
};

const mB: Motion = (t, c, n) => {
  let pos = c;
  for (let i = 0; i < Math.max(1, n); i++) {
    const starts = wordSpans(t).filter(([s]) => s < pos).map(([s]) => s);
    if (!starts.length) return 0;
    pos = starts[starts.length - 1]!;
  }
  return pos;
};

const mE: Motion = (t, c, n) => {
  let pos = c;
  for (let i = 0; i < Math.max(1, n); i++) {
    const ends = wordSpans(t).filter(([, e]) => e > pos).map(([, e]) => e);
    if (!ends.length) return t.length;
    pos = ends[0]!;
  }
  return pos;
};

export const MOTIONS: Record<string, Motion> = {
  h: mH,
  l: mL,
  '0': m0,
  $: mDollar,
  w: mW,
  b: mB,
  e: mE,
  gg: m0,
  G: mDollar,
};

export const TEXT_OBJECTS = [
  'iw', 'aw', 'i"', 'a"', "i'", "a'", 'i(', 'a(', 'i[', 'a[', 'i{', 'a{', 'ip', 'ap',
];

/** 单键操作（vim 里它们自成命令，不需要先按 d/c）。 */
export const ONE_KEY: Record<string, [string, string]> = {
  x: ['d', 'x'],
  D: ['d', 'D'],
  C: ['c', 'C'],
  p: ['p', 'p'],
  P: ['p', 'P'],
};

/**
 * 右向 motion 里**包含末字符**的（vim 语义）：`dl` 删光标下那个字符、`d$` 删到行尾；
 * `dw` 则不包含下一个词的首字符。左向一律不含光标处字符（`dh` 删光标左边一个）。
 */
const INCLUSIVE_RIGHT = new Set(['e', '$', 'G', 'l']);

// ---------------------------------------------------------------- 状态

export interface VimState {
  text: string;
  cursor: number;
  mode: 'normal' | 'insert';
  pending: string;
  count: number;
  note: string;
}

export function makeState(
  text = '',
  cursor = 0,
  mode: 'normal' | 'insert' = 'normal',
  pending = '',
  count = 0,
  note = '',
): VimState {
  return {
    text: String(text),
    cursor: Math.max(0, Math.min(Math.trunc(cursor), String(text).length)),
    mode: mode === 'insert' ? 'insert' : 'normal',
    pending: String(pending),
    count: Math.trunc(count),
    note: String(note),
  };
}

function copy(st: VimState, kw: Partial<VimState> = {}): VimState {
  return { ...st, ...kw };
}

const CMD_RE = /^(\d*)([dcy]?)(\d*)(.*)$/s;
const PREFIX_RE = /^(\d*)([dcy]?)(\d*)$/;

/** 键序列 → `[count, operator, target]`；不合法抛 `VimError`。 */
export function parseCommand(keys: string): [number, string, string] {
  const s = String(keys ?? '');
  const m = CMD_RE.exec(s);
  if (!m) throw new VimError(`看不懂的键序列: ${keys}`);
  const c1 = m[1]!;
  const op = m[2]!;
  const c2 = m[3]!;
  const rest = m[4]!;
  let count = c1 || c2 ? Number(c1 || 1) * Number(c2 || 1) : 1;
  count = count || 1;

  if (!op) {
    if (!rest) throw new VimError('missing action');
    if (!(rest in MOTIONS)) throw new VimError(`未绑定的动作: ${rest}`);
    return [count, '', rest];
  }
  if (!rest) {
    if (op === 'd' || op === 'c' || op === 'y') return [count, op, op]; // dd / cc / yy
    throw new VimError(`操作符 ${op} 后面还缺一个动作`);
  }
  if (rest === op) return [count, op, op];
  if (rest in MOTIONS) return [count, op, rest];
  if (TEXT_OBJECTS.includes(rest) || ['x', 'D', 'C', 'p', 'P'].includes(rest)) {
    return [count, op, rest];
  }
  throw new VimError(`未绑定的目标: ${rest}`);
}

/** 纯光标移动（motion 与操作符共用）。 */
export function moveCursor(text: string, cursor: number, target: string, count = 1): number {
  if (target in MOTIONS) {
    return MOTIONS[target]!(text, Math.max(0, Math.min(cursor, text.length)), Math.max(1, count));
  }
  if (TEXT_OBJECTS.includes(target)) {
    const span = textObject(text, cursor, target);
    if (span === null) throw new VimError(`找不到文本对象: ${target}`);
    return span[0];
  }
  throw new VimError(`未绑定的目标: ${target}`);
}

/** 操作符 + 目标 → 作用区间；目标不存在返回 `null`（正常情况，不是异常）。 */
function rangeFor(
  text: string,
  cursor: number,
  op: string,
  target: string,
  count: number,
): [number, number] | null {
  const n = text.length;
  const cur = Math.max(0, Math.min(cursor, n));
  if (TEXT_OBJECTS.includes(target)) return textObject(text, cur, target);
  if (target === 'x') return [cur, Math.min(n, cur + Math.max(1, count))];
  if (target === 'D' || target === 'C') return [cur, n];
  if (target === 'p' || target === 'P') return [cur, cur];
  if (target === op) return [0, n]; // dd / cc / yy
  if (!(target in MOTIONS)) return null;
  const dest = MOTIONS[target]!(text, cur, Math.max(1, count));
  if (dest >= cur) {
    const end = dest + (INCLUSIVE_RIGHT.has(target) && dest < n ? 1 : 0);
    return [cur, Math.min(n, Math.max(cur, end))];
  }
  return [dest, cur]; // 向左：不含光标处字符
}

/** 把一条完整命令作用到文本上。失败**不改文本**，只留 `note`。 */
export function vimApply(
  state: VimState,
  operator: string,
  target: string,
  count = 1,
  register = '',
): VimState {
  const text = state.text;
  const cur = state.cursor;

  if (!operator) {
    if (!(target in MOTIONS) && !TEXT_OBJECTS.includes(target)) {
      return copy(state, { pending: '', count: 0, note: `error:未绑定的动作: ${target}` });
    }
    try {
      return copy(state, {
        cursor: moveCursor(text, cur, target, count),
        pending: '',
        count: 0,
        note: '',
      });
    } catch (e) {
      return copy(state, { pending: '', count: 0, note: `error:${(e as Error).message}` });
    }
  }

  if (operator === 'p') {
    if (!register) return copy(state, { pending: '', count: 0, note: 'register-empty' });
    return copy(state, {
      text: text.slice(0, cur) + register + text.slice(cur),
      cursor: cur + register.length,
      pending: '',
      count: 0,
      note: '',
    });
  }

  const span = rangeFor(text, cur, operator, target, count);
  if (span === null) return copy(state, { pending: '', count: 0, note: `no-target:${target}` });
  const [start, end] = span;

  if (operator === 'y') {
    return copy(state, {
      cursor: start,
      pending: '',
      count: 0,
      note: `yanked:${text.slice(start, end)}`,
    });
  }

  const newText = text.slice(0, start) + text.slice(end);
  if (operator === 'c') {
    // `c`：删除后进插入模式（vim 的语义）
    return copy(state, {
      text: newText,
      cursor: Math.min(start, newText.length),
      mode: 'insert',
      pending: '',
      count: 0,
      note: '',
    });
  }
  return copy(state, {
    text: newText,
    cursor: Math.min(start, newText.length),
    pending: '',
    count: 0,
    note: '',
  });
}

/** 吃一个键，返回新状态（vim 的核心小状态机）。**凑不齐就停在 pending，不猜。** */
export function vimStep(state: VimState, key: string, register = ''): VimState {
  const k = String(key ?? '');
  const st = state;

  if (st.mode === 'insert') {
    if (k === 'Escape') {
      return copy(st, { mode: 'normal', cursor: Math.max(0, st.cursor - 1), note: '' });
    }
    return st; // 插入模式：调用方自己插字符
  }

  if (k === 'Escape') return copy(st, { pending: '', count: 0, note: '' });

  if (/^[0-9]$/.test(k) && !(k === '0' && !st.pending)) {
    return copy(st, { pending: st.pending + k, note: '' });
  }
  if (['d', 'c', 'y'].includes(k) && !st.pending.endsWith(k)) {
    return copy(st, { pending: st.pending + k, note: '' });
  }
  if ((k === 'i' || k === 'a') && st.mode === 'normal' && !st.pending) {
    return copy(st, { mode: 'insert', note: 'insert' });
  }
  if (k === 'A') return copy(st, { mode: 'insert', cursor: st.text.length, note: 'insert' });
  if (k === 'I') return copy(st, { mode: 'insert', cursor: 0, note: 'insert' });

  if (k in ONE_KEY && (!st.pending || /^\d+$/.test(st.pending))) {
    const [op, target] = ONE_KEY[k]!;
    const count = /^\d+$/.test(st.pending) ? Number(st.pending) : 1;
    return vimApply(copy(st, { pending: '' }), op, target, count, register);
  }

  const seq = st.pending + k;

  if (seq === 'gg' || seq.endsWith('gg') || ['i', 'a'].includes(seq[seq.length - 1]!)) {
    if (
      ['i', 'a'].includes(seq[seq.length - 1]!) &&
      seq.length > 1 &&
      !/^\d$/.test(seq[seq.length - 2]!)
    ) {
      return copy(st, { pending: seq, note: '' });
    }
    if (seq.endsWith('gg')) return vimApply(st, '', 'gg', 1);
  }

  if (
    ['i', 'a'].includes(seq[seq.length - 1]!) &&
    !/[dcy]\d*$/.test(seq.slice(0, -1) || '')
  ) {
    return copy(st, { pending: seq, note: '' });
  }

  let parsed: [number, string, string];
  try {
    parsed = parseCommand(seq);
  } catch (e) {
    // 凑不齐（等下一个键）还是真不认识？只有"前缀"才继续等，其余如实报错
    if (seq.length <= 3 && PREFIX_RE.test(seq)) return copy(st, { pending: seq, note: '' });
    return copy(st, { pending: '', count: 0, note: `error:${(e as Error).message}` });
  }

  const [count, op, target] = parsed;
  if (!op && (target === 'i' || target === 'a')) {
    return copy(st, { pending: seq, note: '' });
  }
  return vimApply(st, op, target, count, register);
}

// ---------------------------------------------------------------- 行编辑器

/**
 * 把 vim 子集接到**一条输入行**上。
 *
 * `enabled=false` 时等同普通插入模式（不拦截任何键）—— 上层不用为"没开 vim"写第二条分支。
 *
 * 方法语义逐条对齐 `ace_vim.VimLineEditor`。几处**看起来可以更"合理"但必须照抄**的地方：
 *   - `feed` 收**一个键**；插入模式下除 `Escape` 外**直接返回 False 且不调 vim_step**；
 *     返回 True 表示"文本或光标变了"，接线方据此决定要不要回写输入框。
 *   - `setText(text, cursor?)` 不传光标时**保持当前光标**（不是归零）—— 粘贴后光标跟着走，
 *     归零会让用户每粘一次就得重按一次 End。
 *   - `backspace` / `insert` **不检查模式**：普通模式的 `x` 走 feed，这两个只管搬字符。
 */
export class VimLineEditor {
  enabled: boolean;
  state: VimState;
  register = '';
  lastNote = '';

  constructor(text = '', cursor = 0, enabled = true) {
    this.enabled = Boolean(enabled);
    this.state = makeState(text, cursor, this.enabled ? 'normal' : 'insert');
  }

  get text(): string {
    return this.state.text;
  }
  get cursor(): number {
    return this.state.cursor;
  }
  get mode(): 'normal' | 'insert' {
    return this.enabled ? this.state.mode : 'insert';
  }
  get pending(): string {
    return this.state.pending;
  }

  /**
   * 状态栏片段：`-- 普通 --` / `-- 插入 d2 --`（带未完成命令）。
   *
   * 与 Python 侧的区别：那边把「普通/插入」**硬编码中文**（`ace_vim.py:441`，
   * 属于已知的 i18n 债）。这里走 i18n，所以文案由调用方传进来 ——
   * 新写的前端不该把那条债也抄过来。
   */
  status(labelNormal: string, labelInsert: string): string {
    const mode = this.mode === 'insert' ? labelInsert : labelNormal;
    const tail = this.state.pending ? ` ${this.state.pending}` : '';
    return `-- ${mode}${tail} --`;
  }

  /** 同步外部改动（粘贴、清空）。不传光标时**保持当前光标**，不归零。 */
  setText(text: string, cursor?: number): void {
    this.state = {
      ...this.state,
      text: String(text ?? ''),
      cursor: cursor === undefined ? this.state.cursor : Math.trunc(cursor),
    };
  }

  reset(): void {
    this.state = makeState('', 0, this.enabled ? 'normal' : 'insert');
    this.lastNote = '';
  }

  /** 吃**一个**键；返回 True = 文本或光标变了（接线方需要回写输入框）。 */
  feed(key: string): boolean {
    if (!this.enabled) return false;
    const before = [this.state.text, this.state.cursor, this.state.mode].join('\u0000');
    // 插入模式下的普通字符由 `insert()` 处理（那是接线方的事），这里只认 Escape。
    // **短路必须在这里**：早返回不只是省一次调用，它决定了 note 不被覆盖。
    if (this.state.mode === 'insert' && key !== 'Escape') return false;
    this.state = vimStep(this.state, key, this.register);
    if (this.state.note.startsWith('yanked:')) {
      this.register = this.state.note.split(':').slice(1).join(':');
    }
    this.lastNote = this.state.note;
    const after = [this.state.text, this.state.cursor, this.state.mode].join('\u0000');
    return after !== before;
  }

  /** 插入模式：在光标处插入文本。**不检查模式** —— 与 Python 侧一致。 */
  insert(chars: string): void {
    const s = String(chars ?? '');
    if (!s) return;
    const { text, cursor } = this.state;
    this.state = copy(this.state, {
      text: text.slice(0, cursor) + s + text.slice(cursor),
      cursor: cursor + s.length,
    });
  }

  /** 退格。**不检查模式** —— 与 Python 侧一致。 */
  backspace(): boolean {
    const { text, cursor } = this.state;
    if (cursor <= 0) return false;
    this.state = copy(this.state, {
      text: text.slice(0, cursor - 1) + text.slice(cursor),
      cursor: cursor - 1,
    });
    return true;
  }
}
