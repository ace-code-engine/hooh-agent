/**
 * 会话管理屏的**纯逻辑** —— 分组 / 过滤 / 工作区名。
 *
 * 为什么把这几步从组件里拆出来：它们是"看一眼就知道对不对"的规则（怎么算一个工作区、
 * 过滤命中谁、名字怎么显示），而终端里验证一面屏的排版很贵。纯函数能直接用断言钉住，
 * 组件只负责把它们画出来。
 *
 * 分组维度取自 `SessionRow.path` 的**父目录**：引擎的 `sessions.request` 只给
 * `{path, when, turns, label}`，没有"工作区"字段 —— 而一条会话属于哪个项目，看它落在
 * 哪个目录就够了（这正是 dsh-TUI 会话管理屏左栏那一列的含义）。
 */

/** 本模块只关心这几个字段（`SessionRow` 的超集也能直接喂进来）。 */
export interface SessionLike {
  readonly path: string;
  readonly label?: string;
  readonly id?: string;
}

export interface WorkspaceGroup<T extends SessionLike = SessionLike> {
  /** 工作区根目录（`path` 的父目录，原样）。 */
  readonly root: string;
  /** 显示名（`~` 折叠 + 目录名）。 */
  readonly name: string;
  /** 该工作区下的会话，**保持引擎给的顺序**（最近在前）。 */
  readonly rows: readonly T[];
}

/** 会话日志所在的目录名 —— 分工作区时要**穿过**它。 */
const SESSIONS_DIR_NAME = '.ace_sessions';

function dirOf(path: string): string {
  const p = String(path ?? '').replace(/[\\/]+$/, '');
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut > 0 ? p.slice(0, cut) : p;
}

/**
 * 一条会话属于哪个工作区。
 *
 * **不是**简单取父目录：会话都落在 `<项目根>/.ace_sessions/xxxx.jsonl`，父目录永远是
 * `.ace_sessions` —— 直接拿它当工作区，所有项目会挤成同一个名字（本模块的用例当场抓到过：
 * 两个项目在左栏都显示 `.ace_sessions`）。真正区分项目的是再上一层，所以这里要**穿过**
 * 那一层。引擎没按这个约定放（自己指定过别的目录）时就按原样返回，不猜。
 */
export function workspaceRoot(path: string): string {
  const dir = dirOf(path);
  const base = dir.split(/[\\/]+/).filter((x) => x !== '').pop();
  return base === SESSIONS_DIR_NAME ? dirOf(dir) : dir;
}

/**
 * 工作区显示名：把 `$HOME` 折叠成 `~`，其余取最后一段目录名。
 *
 * 折叠是必要的：会话路径动辄七十几列，不折的话左栏全是 `C:\Users\...` 的前缀，
 * 真正区分的那个目录名反而被截断在看不见的地方。
 */
export function workspaceName(root: string, home?: string): string {
  let r = String(root ?? '');
  const h = home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (h && r.toLowerCase().startsWith(h.toLowerCase())) r = '~' + r.slice(h.length);
  const parts = r.split(/[\\/]+/).filter((x) => x !== '');
  return parts.length > 0 ? parts[parts.length - 1]! : r;
}

/** 按工作区根分组，组序 = **首次出现的顺序**（引擎按最近排，于是最近用过的项目在最上面）。 */
export function groupByWorkspace<T extends SessionLike>(
  rows: readonly T[],
  home?: string,
): WorkspaceGroup<T>[] {
  const byRoot = new Map<string, T[]>();
  for (const row of rows ?? []) {
    const root = workspaceRoot(row.path);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(row);
    else byRoot.set(root, [row]);
  }
  return [...byRoot.entries()].map(([root, group]) => ({
    root,
    name: workspaceName(root, home),
    rows: group,
  }));
}

/**
 * 过滤会话：查询串按空白切词，**每个词都要命中**（label / id / path / 工作区名），
 * 大小写不敏感 —— 与编辑器/选择器里那套"多词 AND"同一口径（`ace_selector.filter_items`）。
 * 空查询原样返回。
 */
export function filterSessions<T extends SessionLike>(
  rows: readonly T[],
  query: string,
  home?: string,
): T[] {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [...rows];
  return (rows ?? []).filter((row) => {
    const hay = [row.label ?? '', row.id ?? '', row.path, workspaceName(workspaceRoot(row.path), home)]
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * 过滤后**丢掉空组**（左栏只列还有内容的项目），并保证选中的组仍然存在。
 * 返回新数组（不改入参）。
 */
export function pruneEmptyGroups<T extends SessionLike>(
  groups: readonly WorkspaceGroup<T>[],
): WorkspaceGroup<T>[] {
  return groups.filter((g) => g.rows.length > 0);
}
