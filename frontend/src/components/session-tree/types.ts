/**
 * 会话树的数据形状 —— **只认卡片已文档化的字段**
 * （`docs/design/DshShell-AceCapabilities.md` §3.7b 的 `sessiontree.request`）。
 *
 * 为什么要一个归一化层，而不是让组件直接读 `unknown`：
 *   1. 协议面**还没接出去**（`sessiontree.request` 是引擎侧在做的活）。前端先落地，
 *      就必须对"字段缺席"有明确答案 —— 缺成 `undefined` 混进渲染层就是空白或崩。
 *   2. 会话日志是**磁盘文件**，可能被手改、被老版本写、半截崩掉。`parent` 指向不存在的
 *      seq、`tips` 缺项、重复 seq 都出现过。这里一律降级成**能画的东西**，
 *      画不出来的（没有 seq）直接丢掉 —— 不猜、不编。
 *   3. 跨文件父子关系（`parent_session`）**今天没有生产者**，恒 `""`。
 *      界面按"如实标不可用"显示，不许拿它假装有血缘。
 */

/** 树里的一个条目。`seq` 是会话日志里的稳定身份（也是 `/tree` 的落点）。 */
export interface SessionNode {
  seq: number;
  /** 原始 kind（今天只可能是 `user/message` / `assistant/message`）。认不出的不硬套标签。 */
  kind: string;
  /** 本分支上一条消息的 seq；`0` = 根（也兜住悬空/自指的坏数据）。 */
  parent: number;
  /** 是不是分支末梢（没有别的条目把它当 parent）。 */
  tip: boolean;
  /** 第几轮；`0` = 引擎没给（不显示轮次列，也不拿 seq 冒充）。 */
  turn: number;
  /** 单行摘要。 */
  preview: string;
  /** 引擎标的"在当前分支上"。 */
  active: boolean;
}

export interface SessionTreeData {
  sessionId: string;
  nodes: SessionNode[];
  /** 当前活跃分支头（`active_head()`）。`0` = 引擎没给。 */
  activeHead: number;
  /** 各分支末梢的 seq，**顺序即 `/tree <编号>` 的编号**。 */
  tips: number[];
  /** 只有一条分支（引擎口径）；缺字段时按 `tips.length <= 1` 推。 */
  single: boolean;
  /** 跨会话来源；无生产者 ⇒ 恒空。 */
  parentSession: string;
}

function intOf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function strOf(v: unknown): string {
  if (typeof v === 'string') return v;
  return v === null || v === undefined ? '' : String(v);
}

/** 空树（请求失败 / 引擎还没发这个字段时走这里，而不是抛）。 */
export function emptyTree(): SessionTreeData {
  return { sessionId: '', nodes: [], activeHead: 0, tips: [], single: true, parentSession: '' };
}

/**
 * 把引擎响应（或任何 `unknown`）拧成能渲染的形状。**永不抛**。
 *
 * 几条硬规则：
 *   - 没有 `seq`（或 `seq <= 0`）的条目丢掉 —— 它没有身份，画出来也点不动；
 *   - `parent` 指向不存在的 seq / 指向自己 ⇒ 当根（`flattenTree` 再兜环）；
 *   - `tips` 缺 ⇒ 用带 `tip` 标记的条目按 seq 补（顺序可预测）；
 *   - `active_head` 缺 ⇒ 用唯一标了 `active` 的条目；再没有就 `0`（**不拿最后一条冒充当前**）。
 */
export function normalizeTree(raw: unknown): SessionTreeData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyTree();
  const r = raw as Record<string, unknown>;

  const nodes: SessionNode[] = [];
  const seen = new Set<number>();
  for (const item of Array.isArray(r.nodes) ? r.nodes : []) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const seq = intOf(n.seq);
    if (seq <= 0 || seen.has(seq)) continue;
    seen.add(seq);
    const parent = intOf(n.parent);
    nodes.push({
      seq,
      kind: strOf(n.kind),
      parent: parent === seq ? 0 : parent,
      tip: n.tip === true,
      turn: Math.max(0, intOf(n.turn)),
      preview: strOf(n.preview),
      active: n.active === true,
    });
  }
  // 顺着 seq 排：引擎给的序本来就该是链序，乱序也不至于把树画成面条。
  nodes.sort((a, b) => a.seq - b.seq);

  const rawTips = (Array.isArray(r.tips) ? r.tips : []).map(intOf).filter((s) => s > 0);
  const tips = rawTips.length > 0 ? [...new Set(rawTips)] : nodes.filter((n) => n.tip).map((n) => n.seq);

  const activeHead = intOf(r.active_head) || nodes.find((n) => n.active)?.seq || 0;

  return {
    sessionId: strOf(r.session_id),
    nodes,
    activeHead,
    tips,
    single: typeof r.single === 'boolean' ? r.single : tips.length <= 1,
    parentSession: strOf(r.parent_session),
  };
}
