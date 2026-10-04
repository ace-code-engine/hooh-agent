/**
 * diff 渲染 —— 逐条照抄 `ui/ace_diff.py` 的口径。
 *
 * 为什么"改动可见"比"命令可见"更要紧（那边文件头写的）：跑错一条命令当场就知道，
 * 改错一行往往几天后才发现。
 *
 * 三条从 Python 侧带过来的判据，都不是随便定的：
 *   1. `looksLikeDiff` **刻意保守** —— 要求 `@@` 或 `---`/`+++` 成对出现。
 *      工具输出里以 `+`/`-` 开头的行很常见（表格、列表、密码学），只按首字符判断
 *      会把普通输出误染成 diff。
 *   2. **文件头不计入增删** —— 否则每个 diff 都"删了一行、加了一行"，数字失去意义。
 *   3. **文件头按 dim 而非红绿** —— 它们不是"删了这行、加了那行"。
 *   4. **行首给状态槽、不给行号**（借鉴 dsh-TUI `SplitDiffView` 的 issue #250）——
 *      见下面 `DiffSlot`：工具输出里没有文件偏移，编出来的行号是假信息。
 *
 * 纯函数：不碰 Ink、不读宽度（宽度由调用方截断），所以可穷举测。
 */

/** 与 `ace_diff.MAX_DIFF_LINES` 一致。 */
export const MAX_DIFF_LINES = 200;

/** 主题 token 名（不是 ANSI 名）—— 由调用方喂给 `color()`。 */
export type DiffToken = 'success' | 'error' | 'info' | 'dim';

export interface DiffStat {
  added: number;
  removed: number;
  files: string[];
}

export function looksLikeDiff(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.startsWith('@@'))) return true;
  const hasOld = lines.some((l) => l.startsWith('--- '));
  const hasNew = lines.some((l) => l.startsWith('+++ '));
  return hasOld && hasNew;
}

export function summarizeDiff(text: string): DiffStat {
  let added = 0;
  let removed = 0;
  const files: string[] = [];
  for (const ln of (text ?? '').split(/\r?\n/)) {
    if (ln.startsWith('+++ ') || ln.startsWith('--- ')) {
      const name = ln.slice(4).trim();
      if (name && name !== '/dev/null' && !files.includes(name)) {
        files.push(name.split('\t')[0]!);
      }
      continue;
    }
    if (ln.startsWith('@@')) continue;
    if (ln.startsWith('+')) added++;
    else if (ln.startsWith('-')) removed++;
  }
  return { added, removed, files };
}

/** 行首标记：`+` / `-` / `@` / ` ` / `?`（不是 diff 行）。 */
export function diffMarker(line: string): string {
  if (!line) return '?';
  const ch = line[0]!;
  return '+-@ '.includes(ch) ? ch : '?';
}

export function colorName(line: string): DiffToken {
  if (line.startsWith('--- ') || line.startsWith('+++ ')) return 'dim';
  switch (diffMarker(line)) {
    case '+':
      return 'success';
    case '-':
      return 'error';
    case '@':
      return 'info';
    default:
      return 'dim';
  }
}

export interface DiffLine {
  /**
   * 行首状态槽 —— **替代行号**（借鉴 dsh-TUI `SplitDiffView`，他们 issue #250 的理由：
   * 工具给的 diff **不带文件偏移**，行号只能编；编错的行号比没有行号更糟 ——
   * 人会拿它去 `sed -n '<n>p'`，然后看到不是自己以为的那一行）。
   * 所以每一行只声明它**是什么**，不假装知道它在文件里的第几行。
   */
  slot: DiffSlot;
  /**
   * 正文 —— **已去掉原行首的标记字符**（标记挪到 `slot` 了，否则会渲染成 `- -旧行`）。
   * 文件头/杂项行不是"标记 + 正文"结构，整行留在 `text` 里。
   */
  text: string;
  token: DiffToken;
}

/**
 * 状态槽：`+` 增 · `-` 删 · ` ` 上下文 · `~` 块头（`@@`）· `?` 不是 diff 行。
 *
 * `?` 这一档是必须的，不是凑数：`--- a/x` 的第一个字符也是 `-`，没有它就等于
 * 把文件头谎报成"删了这行"（`colorName` 早就按 dim 处理它们了，槽位得跟上）。
 */
export type DiffSlot = '+' | '-' | ' ' | '~' | '?';

export function diffSlot(line: string): DiffSlot {
  if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ')) return '?';
  switch (diffMarker(line)) {
    case '+':
      return '+';
    case '-':
      return '-';
    case ' ':
      return ' ';
    case '@':
      return '~';
    default:
      return '?';
  }
}

/** Tab → 3 空格：一个 Tab 显示几列取决于制表位，宽度算式会当场散架（照抄他们的 `expandTabs`）。 */
function expandTabs(line: string): string {
  return line.replace(/\t/g, '   ');
}

/**
 * diff 文本 → 待渲染行 + 状态槽 + 颜色 token。
 *
 * 超过 `maxLines` 时截断并**追加一行说明**（不冒充完整）—— 静默截断会让用户
 * 以为"就改了这些"；那一行的槽位是 `?`（它不是 diff 行）。
 */
export function colorizeDiff(text: string, maxLines: number = MAX_DIFF_LINES): DiffLine[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const capped = lines.length > maxLines;
  const shown = lines.slice(0, maxLines);
  const out: DiffLine[] = shown.map((raw) => {
    const line = expandTabs(raw);
    const slot = diffSlot(line);
    return {
      slot,
      // 标记已经在槽位里了：`+`/`-`/空格 这三档把原行首那个字符去掉
      text: slot === '?' || slot === '~' ? line : line.slice(1),
      token: colorName(line),
    };
  });
  if (capped) {
    out.push({
      slot: '?',
      text: `… 还有 ${lines.length - maxLines} 行`,
      token: 'dim',
    });
  }
  return out;
}

/** 一行统计 `+3 -1`；无改动返回空串（让调用方不显示）。 */
export function statText(text: string): string {
  const s = summarizeDiff(text);
  if (!s.added && !s.removed) return '';
  return `+${s.added} -${s.removed}`;
}

export interface DiffHunk {
  header: string;
  added: number;
  removed: number;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

/**
 * 按文件切开 diff（两级视图的第一级）。
 *
 * 为什么要两级：一次改 5 个文件时几百行全铺出来，用户连"改了哪些文件"都看不出来。
 *
 * 路径取 `+++ ` 那行：删除文件时 `--- ` 是 `/dev/null`，拿它当路径会得到一个
 * 不存在的"文件名"。`b/` / `a/` 前缀要剥掉。
 */
export function splitByFile(text: string): DiffFile[] {
  const out: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let seenNew = false;

  const newSection = (): DiffFile => {
    const sec: DiffFile = { path: '', added: 0, removed: 0, hunks: [] };
    out.push(sec);
    return sec;
  };

  for (const ln of (text ?? '').split(/\r?\n/)) {
    if (ln.startsWith('diff --git ') || (ln.startsWith('--- ') && seenNew)) {
      cur = newSection();
      hunk = null;
      seenNew = false;
    } else if (cur === null) {
      cur = newSection();
    }

    if (ln.startsWith('+++ ')) {
      let name = ln.slice(4).trim().split('\t')[0]!;
      if (name && name !== '/dev/null') {
        for (const px of ['b/', 'a/']) {
          if (name.startsWith(px)) {
            name = name.slice(px.length);
            break;
          }
        }
        cur.path = name;
      }
      seenNew = true;
      continue;
    }
    if (ln.startsWith('--- ')) continue;

    if (ln.startsWith('@@')) {
      hunk = { header: ln.trim(), added: 0, removed: 0 };
      cur.hunks.push(hunk);
      continue;
    }
    if (ln.startsWith('+')) {
      cur.added++;
      if (hunk) hunk.added++;
    } else if (ln.startsWith('-')) {
      cur.removed++;
      if (hunk) hunk.removed++;
    }
  }
  return out.filter((s) => s.path || s.hunks.length);
}
