/**
 * 全屏草稿编辑器的**缓冲区** —— 纯逻辑，没有 React、没有 i18n、不碰终端。
 *
 * ## 为什么单独一层
 *
 * 编辑器最难测的不是"按键接上了没有"，而是**光标算术**：跨行退格、上下走列、
 * 撤销的粒度、翻页窗口。这些全是纯函数，单独放一层就能拿 assert 钉死；
 * 塞进组件里就只剩"渲染出一帧、肉眼看对不对"，改一个边界要跑一遍渲染器。
 *
 * ## 借鉴来源（`dsh-TUI-main/src/components/PromptInput.tsx`，MIT）
 *
 *   - 多行编辑/换行插入：`:2502-2558`（Enter=换行、Tab=4 空格）
 *   - 展开态的行窗口（粘边、不居中）：`:3365-3381`
 *   - 行号槽 + 光标行标记：`:3580-3596`
 *
 * **没抄的**：他们的词级 undo（`:1687-1709`）、选区、图片 token、折叠块。
 * 撤销按 ace 的键位与口径来（见 `Draft.undo`）。
 */

import { displayWidth, truncateWidth } from '../../render/text.js';

/** 撤销栈上限 —— 单纯防内存无界（ace 的 Python 侧没有这个数字，取一个够用的）。 */
export const UNDO_LIMIT = 200;

/**
 * `i` 左边那个**字**的起点。
 *
 * 低代理项必须连着高代理项一起算一个 —— 否则退格/左移会把一个 emoji 劈成两半，
 * 屏幕上出现一个孤立的半个代理项（渲染成 `?`，而且再也删不掉）。
 */
export function prevCharStart(line: string, i: number): number {
  if (i <= 0) return 0;
  const end = Math.min(i, line.length);
  const low = line.charCodeAt(end - 1);
  if (low >= 0xdc00 && low <= 0xdfff && end - 2 >= 0) {
    const high = line.charCodeAt(end - 2);
    if (high >= 0xd800 && high <= 0xdbff) return end - 2;
  }
  return end - 1;
}

/** `i` 右边那个**字**的终点（Delete 用）。与 `prevCharStart` 同一条代理项规则。 */
export function nextCharEnd(line: string, i: number): number {
  if (i >= line.length) return line.length;
  const start = Math.max(0, i);
  const high = line.charCodeAt(start);
  if (high >= 0xd800 && high <= 0xdbff && start + 1 < line.length) {
    const low = line.charCodeAt(start + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return start + 2;
  }
  return start + 1;
}

interface Snapshot {
  lines: string[];
  row: number;
  col: number;
}

/**
 * 一段多行草稿 + 一个光标。
 *
 * ## 撤销粒度 = **逐键**（ace 的口径，不是 dsh 的词级）
 *
 * `ui/ace_keys.py:244-245` 把 `ctrl+_` 与 `ctrl+shift+-` 绑到 `undo`，Textual 那一代
 * 是**每按一次键撤一步**（`test_all.py:12286-12305` 钉着"打 hello → ctrl+_ → hell"）。
 * 所以这里在**每一次改动前**压一份快照：一次插入（含整块粘贴）= 一步。
 * dsh 的 700ms 词级合并**没抄** —— 那会凭空多出第二条撤销语义，与 ace 键表对不上。
 *
 * 光标列 `col` 是**码元下标**（不是显示列）：`prevCharStart`/`nextCharEnd` 负责不让
 * 代理项被劈开；显示宽度只在渲染时算（`draftRows`）。上下移动记 `goal` —— 从长行走
 * 到短行再走回来，列不会缩水。
 */
export class Draft {
  lines: string[];
  row = 0;
  col = 0;
  /** 上下移动时的目标列（横向移动/编辑即清空）。 */
  private goal: number | null = null;
  private history: Snapshot[] = [];

  constructor(text = '') {
    this.lines = text.split('\n');
    if (this.lines.length === 0) this.lines = [''];
    this.row = this.lines.length - 1;
    this.col = this.lines[this.row]!.length;
  }

  get text(): string {
    return this.lines.join('\n');
  }

  get lineCount(): number {
    return this.lines.length;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  private snap(): void {
    this.history.push({ lines: [...this.lines], row: this.row, col: this.col });
    if (this.history.length > UNDO_LIMIT) this.history.shift();
  }

  /** 换一段文本、光标落在末尾（$EDITOR 读回时用）。**压一步快照**：Ctrl+_ 能撤回这一趟。 */
  replace(text: string): void {
    this.snap();
    this.lines = text.split('\n');
    if (this.lines.length === 0) this.lines = [''];
    this.row = this.lines.length - 1;
    this.col = this.lines[this.row]!.length;
    this.goal = null;
  }

  /** 撤回一步；栈空返回 false（调用方不用管，直接忽略）。 */
  undo(): boolean {
    const last = this.history.pop();
    if (last === undefined) return false;
    this.lines = last.lines;
    this.row = Math.min(last.row, this.lines.length - 1);
    this.col = Math.min(last.col, this.lines[this.row]!.length);
    this.goal = null;
    return true;
  }

  insert(chunk: string): void {
    if (!chunk) return;
    this.snap();
    const parts = chunk.split('\n');
    const line = this.lines[this.row]!;
    const head = line.slice(0, this.col);
    const tail = line.slice(this.col);
    if (parts.length === 1) {
      const mid = parts[0]!;
      this.lines[this.row] = head + mid + tail;
      this.col = head.length + mid.length;
    } else {
      const mid = parts.slice(1, -1);
      const last = parts[parts.length - 1]!;
      this.lines.splice(this.row, 1, head + parts[0]!, ...mid, last + tail);
      this.row += parts.length - 1;
      this.col = last.length;
    }
    this.goal = null;
  }

  backspace(): void {
    if (this.col === 0) {
      if (this.row === 0) return;
      this.snap();
      const above = this.lines[this.row - 1]!;
      const here = this.lines[this.row]!;
      this.lines.splice(this.row - 1, 2, above + here);
      this.row -= 1;
      this.col = above.length;
      this.goal = null;
      return;
    }
    this.snap();
    const line = this.lines[this.row]!;
    const at = prevCharStart(line, this.col);
    this.lines[this.row] = line.slice(0, at) + line.slice(this.col);
    this.col = at;
    this.goal = null;
  }

  deleteForward(): void {
    const line = this.lines[this.row]!;
    if (this.col >= line.length) {
      if (this.row >= this.lines.length - 1) return;
      this.snap();
      const next = this.lines[this.row + 1]!;
      this.lines.splice(this.row, 2, line + next);
      this.goal = null;
      return;
    }
    this.snap();
    const end = nextCharEnd(line, this.col);
    this.lines[this.row] = line.slice(0, this.col) + line.slice(end);
    this.goal = null;
  }

  /** `ctrl+u` —— 删到本行行首（够到行首就删掉换行，与常见行编辑一致）。 */
  killToStart(): void {
    if (this.col === 0) {
      this.backspace();
      return;
    }
    this.snap();
    this.lines[this.row] = this.lines[this.row]!.slice(this.col);
    this.col = 0;
    this.goal = null;
  }

  /** `ctrl+k` —— 删到本行行尾（行尾就把下一行接上来）。 */
  killToEnd(): void {
    const line = this.lines[this.row]!;
    if (this.col >= line.length) {
      this.deleteForward();
      return;
    }
    this.snap();
    this.lines[this.row] = line.slice(0, this.col);
    this.goal = null;
  }

  /** `ctrl+w` —— 往左吃掉一段空白 + 一个词。 */
  killWordLeft(): void {
    const line = this.lines[this.row]!;
    const head = line.slice(0, this.col).replace(/\S*\s*$/, '');
    if (head === line.slice(0, this.col)) {
      this.backspace();
      return;
    }
    this.snap();
    this.lines[this.row] = head + line.slice(this.col);
    this.col = head.length;
    this.goal = null;
  }

  moveLeft(): void {
    if (this.col > 0) this.col = prevCharStart(this.lines[this.row]!, this.col);
    else if (this.row > 0) {
      this.row -= 1;
      this.col = this.lines[this.row]!.length;
    }
    this.goal = null;
  }

  moveRight(): void {
    const line = this.lines[this.row]!;
    if (this.col < line.length) this.col = nextCharEnd(line, this.col);
    else if (this.row < this.lines.length - 1) {
      this.row += 1;
      this.col = 0;
    }
    this.goal = null;
  }

  private vertical(delta: number): void {
    const target = this.row + delta;
    if (target < 0 || target >= this.lines.length) return;
    const goal = this.goal ?? this.col;
    this.row = target;
    this.col = Math.min(goal, this.lines[target]!.length);
    this.goal = goal;
  }

  moveUp(): void {
    this.vertical(-1);
  }

  moveDown(): void {
    this.vertical(1);
  }

  /** 翻页：一次走 `rows` 行（行数是**可见区行数**，由渲染层给）。 */
  movePage(delta: number, rows: number): void {
    const step = Math.max(1, Math.trunc(rows));
    const goal = this.goal ?? this.col;
    const target = Math.max(0, Math.min(this.row + delta * step, this.lines.length - 1));
    this.row = target;
    this.col = Math.min(goal, this.lines[target]!.length);
    this.goal = goal;
  }

  moveLineStart(): void {
    this.col = 0;
    this.goal = null;
  }

  moveLineEnd(): void {
    this.col = this.lines[this.row]!.length;
    this.goal = null;
  }
}

// ─────────────────────────────────────────────────────────── 视图模型

/** 一屏里的一行：行号 + 光标前后的文本 + 这段是不是光标所在行。 */
export interface DraftRow {
  /** 1 起的行号。 */
  no: number;
  before: string;
  /** 光标处那个字（行尾/空行是空串 —— 渲染层退化成 `▌`）。 */
  caret: string;
  after: string;
  isCaret: boolean;
}

/**
 * 光标跑出屏幕时，长行往左滑一段 —— 把**光标前**最多 `budget` 个显示列留在窗口里。
 *
 * 为什么按显示列回退而不是按码点：一行中文 40 个字就是 80 列，按码点切窗口会让
 * 光标贴在屏幕外。**回退**（而不是从行首正着切）才是"光标永远看得见"的那一条。
 */
function slideStart(line: string, caret: number, budget: number): number {
  let start = caret;
  let used = 0;
  while (start > 0) {
    const at = prevCharStart(line, start);
    const w = displayWidth(line.slice(at, start));
    if (used + w > budget) break;
    used += w;
    start = at;
  }
  return start;
}

/**
 * 把缓冲区的 `[from, from+count)` 行算成可渲染的行（纯函数，能直接断言）。
 *
 * `width` 是**整行宽**：行号槽实占 `gutter + 3`（定宽数字 + 空格 + 竖条 + 空格），
 * 剩下的才是正文。超宽的行截断（非光标行）或滑动（光标行）。
 */
export function draftRows(
  draft: Draft,
  opts: { from: number; count: number; width: number; gutter: number },
): DraftRow[] {
  const content = Math.max(4, opts.width - opts.gutter - 3);
  const rows: DraftRow[] = [];
  for (let i = opts.from; i < Math.min(opts.from + opts.count, draft.lineCount); i++) {
    const line = draft.lines[i]!;
    const isCaret = i === draft.row;
    if (!isCaret) {
      rows.push({ no: i + 1, before: truncateWidth(line, content), caret: '', after: '', isCaret: false });
      continue;
    }
    const start = slideStart(line, draft.col, Math.max(1, content - 1));
    const win = line.slice(start);
    const at = draft.col - start;
    const before = win.slice(0, at);
    const after = win.slice(at + 1);
    const caret = at < win.length ? win[at]! : '';
    // 光标那个字本身可能占两列（CJK），余量按它的**显示宽度**扣，不然整行会多宽一格被折行
    const room = Math.max(0, content - displayWidth(before) - (caret === '' ? 1 : displayWidth(caret)));
    rows.push({
      no: i + 1,
      before,
      caret,
      after: truncateWidth(after, room, ''),
      isCaret: true,
    });
  }
  return rows;
}
