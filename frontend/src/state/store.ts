/**
 * 转写区状态 —— **纯 reducer**，不碰 React、不碰进程。
 *
 * 为什么单拎出来：事件驱动的界面最容易出的错全在"事件到达顺序不按预想"上
 * （`tool_result` 先于 `tool_start`、`final` 之后又来一条 `notice`、同一个工具连着跑两次）。
 * 这些用一堆纯函数就能穷举测；塞进组件里就只能靠手点，而手点永远覆盖不到那些顺序。
 */

import type { AceEvent, ChoiceKind, GrantDecision, StatusSegmentWire } from '../protocol/types.js';
import { looksLikeDiff } from '../render/diff.js';
import type { Phase } from '../render/spinner.js';

export type ToolStatus = 'running' | 'ok' | 'fail';

export type Item =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string; streaming: boolean; round?: number }
  | {
      kind: 'tool';
      id: number;
      tool: string;
      target?: string;
      status: ToolStatus;
      elapsed?: number;
      message?: string;
      exitCode?: number | null;
      /** 这次改动的 unified diff（写类工具才有）。工具卡片据此画 +/− 与统计。 */
      diff?: string;
    }
  | { kind: 'notice'; id: number; text: string }
  | { kind: 'error'; id: number; text: string }
  | { kind: 'permission'; id: number; tool: string; reason: string; answered?: GrantDecision };

export interface Meta {
  version?: string;
  model?: string;
  permission?: string;
  sandbox?: string;
  projectRoot?: string;
  mock?: boolean;
  /**
   * 引擎报告的状态行分段（`status` 事件）。
   *
   * 空数组 = 退回前端自算（`StatusLine.buildSegments`）：`status` 只在会话开始 /
   * 每轮请求 / 每次工具往返 / 每轮收尾发，界面挂载得比第一个事件早、或引擎侧取不到
   * 分段时，那一行不该是空的。
   *
   * **优先用引擎的**：底栏该显示哪几段是引擎的判断（`/statusline` 配置、
   * "颜色即语义"的告警档），前端自己再算一份就会出现"CLI 说 92%、前端说 40%"。
   */
  statusSegments: StatusSegmentWire[];
  /** 会话是否已结束。 */
  ended: boolean;
  rounds: number;
  tools: number;
  /**
   * 当前阶段 —— 决定等待指示器画哪套字形与速度。
   *
   * 为什么让状态机来定而不是组件自己猜：**速度本身是语义**（见 `render/spinner.ts`）。
   * 组件拿不到"现在卡在哪一步"，只有事件流知道。
   */
  phase: Phase | '';
  /**
   * 引擎最后一次"产出可见内容"的时刻（秒，取事件的 `ts`）—— 驱动等待指示器的
   * **卡住判定**（R-7）。0 = 本轮还没产出过。
   *
   * 为什么存 `ts` 而不是 `Date.now()`：reducer 必须是**纯函数**（同一串事件跑两遍
   * 结果一致，见 `applyEvent` 的 docstring），`Date.now()` 会破坏它。
   */
  lastOutputAt: number;
}

export interface State {
  items: Item[];
  meta: Meta;
  /** 正在等待答案的审批（有值 = 应弹授权框）。 */
  pendingPermission: { tool: string; reason: string; itemId: number } | null;
  /** 正在等待答案的选择（有值 = 应弹选择框）。同一时刻只会有一个。 */
  pendingChoice: {
    kind: ChoiceKind;
    title: string;
    options: string[];
    defaultValue: string;
    /** 凭据输入：外壳**不许回显**（H-33 / H-34a）。 */
    secret: boolean;
    itemId: number;
  } | null;
  /** 是否正在跑一轮（用于输入框禁用 / spinner）。 */
  busy: boolean;
  /** 单调递增的条目 id。 */
  seq: number;
}

export function initialState(): State {
  return {
    items: [],
    meta: { statusSegments: [], ended: false, rounds: 0, tools: 0, phase: '', lastOutputAt: 0 },
    pendingPermission: null,
    pendingChoice: null,
    busy: false,
    seq: 0,
  };
}

/**
 * 对联合类型做 Omit。内建的 `Omit` 作用在联合上会**塌缩成公共键**
 * （`Item` 各分支只有 `kind`/`id` 是共有的），于是 `{kind:'tool', tool:...}`
 * 就报"对象字面量不能指定已知属性" —— 这是 TS 的一个经典坑，必须分发。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewItem = DistributiveOmit<Item, 'id'>;

function push(state: State, item: NewItem): State {
  const id = state.seq + 1;
  return { ...state, seq: id, items: [...state.items, { ...item, id } as Item] };
}

/**
 * 最后一条**还在流**的助手消息的下标；没有则 -1。
 *
 * 为什么不直接看 `items[items.length - 1]`：工具时间线（`⚙ 2 次工具调用`）、耗时、快照
 * 提示这些 notice 会插在增量与 `final` 之间。只看最后一条就会漏掉合并，症状是
 * **同一段回答出现两遍**（`final` 又推一条）或**被劈成两条**（后续增量另起一条）——
 * 两个都是实测踩到过的。
 *
 * 遇到 `user` 项就停下：那是上一轮的用户消息，绝不跨轮合并。
 */
function lastStreamingAssistant(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'user') return -1;
    if (it.kind === 'assistant' && it.streaming) return i;
  }
  return -1;
}

/**
 * 把一个事件折进状态。**永不修改入参** —— 便于 React 做引用比较，
 * 也让"同一串事件跑两遍结果一致"这件事可断言。
 */
export function applyEvent(state: State, ev: AceEvent): State {
  switch (ev.type) {
    case 'session_start': {
      return {
        ...state,
        meta: {
          ...state.meta,
          version: str(ev.version),
          model: str(ev.model),
          permission: str(ev.permission),
          sandbox: str(ev.sandbox),
          projectRoot: str(ev.project_root),
          mock: Boolean(ev.mock),
        },
      };
    }

    case 'user_message': {
      // **去重**：前端提交时会先本地乐观播一条（`App.tsx` 的 `handleSubmit`），引擎随后
      // 还会真的发一条 `user_message`。两条都 push 的后果是同一句话在转写区出现**两遍**
      //（实测截图）。留本地那条（它先到、位置也对），引擎那条只负责把"忙"置起来。
      const text = str(ev.text);
      const last = state.items[state.items.length - 1];
      const already = last?.kind === 'user' && last.text === text;
      const next = already ? state : push(state, { kind: 'user', text });
      return { ...next, busy: true, meta: { ...state.meta, phase: 'reasoning' } };
    }

    case 'model_delta': {
      // 流式增量：追加到"最后一条**还在流**的助手消息"上；没有就新开一条。
      // **往回找**，不是只看最后一条 —— 工具时间线（`⚙ 2 次工具调用`）那类 notice 会夹在
      // 增量中间，只看 `last` 会把同一段回答**劈成两条**（实测：◈ 一段 + ◈ 又一段）。
      const items = [...state.items];
      const idx = lastStreamingAssistant(items);
      if (idx >= 0) {
        const prev = items[idx]!;
        if (prev.kind === 'assistant') {
          items[idx] = { ...prev, text: prev.text + str(ev.text) };
          return { ...state, items, meta: { ...state.meta, lastOutputAt: ev.ts } };
        }
      }
      return {
        ...push(state, { kind: 'assistant', text: str(ev.text), streaming: true }),
        meta: { ...state.meta, lastOutputAt: ev.ts },
      };
    }

    case 'final': {
      const text = str(ev.text);
      // **空文本的 final = 只收尾，不产生气泡**：一轮以失败/中断结束时，引擎发不出回复
      // 正文，但必须把界面从"忙"里放出来（否则底栏永远停在"推演中"，看着像还在跑）。
      // 这是引擎侧 `_close_turn_if_open` 的对应端，两边少一边都会让忙碌态泄漏。
      if (!text) return { ...state, busy: false };
      // 流式已经把正文拼好了：收尾时**要么补全、要么原样**，不能再追加一遍
      // （追加的后果是屏幕上出现两遍回答 —— 这是流式渲染最经典的踩坑）。
      // 同样**往回找**那条还在流的助手消息：工具时间线 notice 夹在中间时，
      // 只看最后一条会漏掉合并，把整段回答再推一条出来（实测：回答两遍）。
      const items = [...state.items];
      const idx = lastStreamingAssistant(items);
      if (idx >= 0) {
        const prev = items[idx]!;
        if (prev.kind === 'assistant') {
          items[idx] = {
            ...prev,
            text: prev.text.length >= text.length ? prev.text : text,
            streaming: false,
            round: num(ev.round) ?? prev.round,
          };
          return { ...state, items, busy: false };
        }
      }
      return { ...push(state, { kind: 'assistant', text, streaming: false, round: num(ev.round) }), busy: false };
    }

    case 'tool_start':
      return {
        ...push(state, {
          kind: 'tool',
          tool: str(ev.tool),
          target: str(ev.target) || undefined,
          status: 'running',
        }),
        meta: { ...state.meta, phase: 'tool_running', lastOutputAt: ev.ts },
      };

    case 'tool_result': {
      const tool = str(ev.tool);
      const status: ToolStatus = str(ev.status) === 'SUCCESS' ? 'ok' : 'fail';
      const diff = extractDiff(ev.data);
      const items = [...state.items];
      // 从后往前找**同名且还在跑**的那张卡：工具是串行执行的，所以最近一张就是它。
      // 找不到（例如没收到 tool_start）就补一张 —— 宁可界面多一张卡，也别把结果丢了。
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        if (it.kind === 'tool' && it.status === 'running' && it.tool === tool) {
          items[i] = {
            ...it,
            status,
            elapsed: num(ev.elapsed),
            message: str(ev.message),
            exitCode: ev.exit_code === null || ev.exit_code === undefined ? null : num(ev.exit_code) ?? null,
            diff,
          };
          return { ...state, items, meta: { ...state.meta, tools: state.meta.tools + 1, lastOutputAt: ev.ts } };
        }
      }
      return {
        ...push(state, {
          kind: 'tool',
          tool,
          status,
          elapsed: num(ev.elapsed),
          message: str(ev.message),
          exitCode: ev.exit_code === null || ev.exit_code === undefined ? null : num(ev.exit_code) ?? null,
          diff,
        }),
        meta: { ...state.meta, tools: state.meta.tools + 1, lastOutputAt: ev.ts },
      };
    }

    case 'permission_request': {
      const tool = str(ev.tool);
      const reason = str(ev.reason);
      const next = push(state, { kind: 'permission', tool, reason });
      return {
        ...next,
        pendingPermission: { tool, reason, itemId: next.seq },
      };
    }

    case 'choice_request': {
      const kind = (['choose', 'confirm', 'text'].includes(str(ev.kind))
        ? str(ev.kind)
        : 'choose') as ChoiceKind;
      const title = str(ev.title);
      const next = push(state, { kind: 'notice', text: title });
      return {
        ...next,
        pendingChoice: {
          kind,
          title,
          options: Array.isArray(ev.options) ? ev.options.map(str) : [],
          defaultValue: str(ev.default),
          // 只有**显式 true** 才算凭据：字段缺失（老引擎）按普通文本处理，
          // 但也意味着老引擎永远不会把密钥标出来 —— 那正是 H-33 要修的那一头。
          secret: ev.secret === true,
          itemId: next.seq,
        },
      };
    }

    case 'notice': {
      const text = str(ev.text);
      if (!text.trim()) return state;
      // **被拒的草稿不留**：模型这一轮输出不合协议时，执行层会**拒掉它并重问**；
      // 那条草稿留在屏幕上就是噪音 —— 同一个问题看到两遍不同措辞的回答（实测投诉）。
      // 判据取自引擎自己的提示（`✗ FORMAT_ERROR: …`），只丢"还在流"的那条，
      // 所以不会误删已定稿的回答。
      if (/FORMAT_ERROR|格式错误/.test(text)) {
        const idx = lastStreamingAssistant(state.items);
        if (idx >= 0) {
          // 丢草稿，但**错误行要留着**（发生过格式纠正是事实，别一起吞掉）
          return push({ ...state, items: state.items.filter((_, i) => i !== idx) },
                      { kind: 'notice', text });
        }
      }
      return push(state, { kind: 'notice', text });
    }

    case 'error': {
      // 引擎的错误事件此前**没有被消费**（`default:` 直接忽略），于是 error 类信息
      // 到不了界面。这里补上，并沿用"被拒的草稿不留"这条口径。
      const text = str(ev.text);
      if (!text.trim()) return state;
      const idx = /FORMAT_ERROR|格式错误/.test(text) ? lastStreamingAssistant(state.items) : -1;
      const items = idx >= 0 ? state.items.filter((_, i) => i !== idx) : state.items;
      return push({ ...state, items }, { kind: 'error', text });
    }

    case 'agent_preset': {
      // WP-6：预设切换。这个事件类型引擎侧一直**发不出来**（`emit_switch` 没有调用方），
      // 所以前端也没有消费者；`/preset` 补上入口之后它才真的会到这儿。
      // 文案**不写句子、只写事实**（`agent: 名字 ▸ 更严的维度`）：store 是纯 reducer、
      // 拿不到 i18n，而这个仓库的既有口径是"发数据不发译文"。要成句就交给渲染层查字典。
      const name = str(ev.name);
      if (!name) return push(state, { kind: 'notice', text: 'agent: (none)' });
      const changed = Array.isArray(ev.changed) ? ev.changed.map(str).filter(Boolean) : [];
      return push(state, {
        kind: 'notice',
        text: changed.length ? `agent: ${name} ▸ ${changed.join(', ')}` : `agent: ${name}`,
      });
    }

    case 'status': {
      // 整个 payload 不是数组 = 这一帧坏了：**保持上一份**。把底栏抹成空比留着旧数据更糟
      // （与 `default:` 分支"不认识的事件类型忽略并继续"同一个口径）。
      // 数组本身是**权威快照**（引擎每次发全量），所以数组里的坏行逐条丢。
      if (!Array.isArray(ev.segments)) return state;
      return {
        ...state,
        meta: { ...state.meta, statusSegments: parseStatusSegments(ev.segments) },
      };
    }

    case 'model_request':
      // 每一轮模型请求 = 模型又开始生成了 ⇒ 相位回到 `reasoning`（"推演中"）。
      // 不写这一句的后果是**标签说谎**：工具跑完之后相位一直停在 `tool_running`，
      // 模型明明在推，底栏却还写着"工具执行中"。
      return {
        ...state,
        busy: true,
        meta: {
          ...state.meta,
          phase: 'reasoning',
          rounds: Math.max(state.meta.rounds, num(ev.round) ?? 0),
        },
      };

    case 'session_end':
      return {
        ...state,
        busy: false,
        meta: {
          ...state.meta,
          ended: true,
          phase: '',
          rounds: num(ev.rounds) ?? state.meta.rounds,
          tools: num(ev.tools) ?? state.meta.tools,
        },
      };

    default:
      // 不认识的事件类型：**不报错也不显示**。协议会加新事件，旧前端遇到新的
      // 应该忽略并继续 —— 而不是崩掉或往屏幕上打一行内部类型名。
      return state;
  }
}

/** 把审批答案记下来：授权框据此关掉，转写区留一条"当时怎么答的"。 */export function applyPermissionAnswer(
  state: State,
  decision: GrantDecision,
): State {
  if (!state.pendingPermission) return state;
  const { itemId } = state.pendingPermission;
  const items = state.items.map((it) =>
    it.id === itemId && it.kind === 'permission' ? { ...it, answered: decision } : it,
  );
  return { ...state, items, pendingPermission: null };
}

/** 答完选择框：待答清掉，并顺手把已答状态清空（与授权那条同口径）。 */
export function applyChoiceAnswer(state: State): State {
  if (!state.pendingChoice) return state;
  return { ...state, pendingChoice: null };
}

export function applyEvents(state: State, events: AceEvent[]): State {
  return events.reduce(applyEvent, state);
}

// ---------------------------------------------------------------- 取值助手

/**
 * 从 `tool_result.data` 里取 diff。
 *
 * 两道闸：必须是字符串，且必须**看起来像 unified diff**（`looksLikeDiff`）。
 * 第二道不能省 —— 工具输出里以 `+`/`-` 开头的行很常见，直接当 diff 画会把
 * 一张表格染成一屏红绿。
 */
function extractDiff(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const raw = (data as Record<string, unknown>).diff;
  if (typeof raw !== 'string' || !raw) return undefined;
  return looksLikeDiff(raw) ? raw : undefined;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 解析 `status` 事件里的分段。
 *
 * 逐条挑字段而不是整包信任：协议会加字段，旧前端遇到不认识的键应该忽略并继续
 * （与 `default:` 分支"不认识的事件类型不报错"同一个口径）。缺 `text` 的段直接丢掉 ——
 * 一段没有文字的状态在屏幕上只是一条多余的分隔符。
 */
export function parseStatusSegments(raw: unknown): StatusSegmentWire[] {
  if (!Array.isArray(raw)) return [];
  const out: StatusSegmentWire[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const text = str(r.text);
    if (!text) continue;
    out.push({
      name: str(r.name),
      text,
      priority: num(r.priority) ?? 50,
      level: str(r.level) || 'info',
    });
  }
  return out;
}
