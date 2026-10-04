/**
 * 协议类型 —— 与 Python 侧逐条对应。
 *
 * 权威来源有两处，改协议时两边都要动：
 *   - 帧形状：`core/ace_serve.py`（`PROTOCOL_VERSION` / `make_resp` / `make_event_frame`）
 *   - 事件必填字段：`core/ace_events.EVENT_REQUIRED`
 *
 * 这里**不重复定义**必填字段（那会变成第二份会漂的 schema），只定义形状。
 * `test/protocol.test.ts` 会读 `EVENT_REQUIRED` 比对事件类型集合。
 */

export const PROTOCOL_VERSION = 1;

/** 与 `core/ace_events.EVENT_TYPES` 一致。 */
export const EVENT_TYPES = [
  'session_start',
  'user_message',
  'model_request',
  'tool_start',
  'tool_call',
  'tool_result',
  'permission_request',
  'choice_request',
  'notice',
  'final',
  'session_end',
  'model_delta',
  'status',
  'agent_preset',
  'language',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** 一条事件。字段随类型而异 —— 具体必填项见 Python 的 `EVENT_REQUIRED`。 */
export interface AceEvent {
  type: EventType | string;
  ts: number;
  [field: string]: unknown;
}

/** 服务端 → 客户端的响应帧。失败时**不带 result**（别在两种字段间猜）。 */
export interface RespFrame {
  v: number;
  type: 'resp';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    http_like?: string;
    data?: unknown;
  };
}

/** 服务端 → 客户端的事件帧。`seq` 单调递增，据此发现丢帧。 */
export interface EventFrame {
  v: number;
  type: 'event';
  seq: number;
  event: AceEvent;
}

/** 客户端 → 服务端的请求帧。 */
export interface ReqFrame {
  v: number;
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export type Frame = RespFrame | EventFrame | ReqFrame;

// ---------------------------------------------------------------- 事件负载

/**
 * 事件负载的类型化视图。字段全部可选 —— 因为协议的权威 schema 在 Python 侧，
 * 这里做**尽力而为**的收窄：拿不到的字段就是 undefined，调用方必须自己兜。
 * 这样不会出现"TS 说一定有、Python 其实没发"的假安全感。
 */
export interface ToolStartEvent extends AceEvent {
  type: 'tool_start';
  tool: string;
  target?: string;
}

export interface ToolResultEvent extends AceEvent {
  type: 'tool_result';
  tool: string;
  status: string;
  /**
   * **机器通道**（`THREE-LAYERS` RL-01）：闭集 `success | denied | failed | partial | deferred`。
   *
   * 与 `status` 各说各的：`status` 是"发生了什么"（给人看），`outcome` 是"下一步该干什么"
   * （给驱动层判）。`denied` 是**被拒**（此路不通的知识），`failed` 才是**没成**（该升级的状态）。
   * 唯一来源 `tools.status.outcome_for`；`test_all [36]` 逐条钉住映射。
   */
  outcome?: string;
  elapsed: number;
  message: string;
  exit_code?: number | null;
  data?: unknown;
}

export interface PermissionRequestEvent extends AceEvent {
  type: 'permission_request';
  tool: string;
  reason: string;
}

/** `kind` 决定弹什么：列表选择 / 二选一 / 文本输入。 */
export type ChoiceKind = 'choose' | 'confirm' | 'text';

export interface ChoiceRequestEvent extends AceEvent {
  type: 'choice_request';
  kind: ChoiceKind;
  title: string;
  /** `choose` 才有：候选文本列表。 */
  options?: string[];
  /** `text` 才有：预填值。 */
  default?: string;
  /**
   * `text` 才有：**凭据输入**，外壳不许回显（H-33 / H-34a）。
   *
   * 引擎侧由 `WizardStep.hidden` 一路传到这里；缺省/缺字段 = 普通文本。
   */
  secret?: boolean;
  /** `choose` 才有：是否附带「思考强度」行（只在模型选择框里开）。 */
  with_effort?: boolean;
}

export interface FinalEvent extends AceEvent {
  type: 'final';
  text: string;
  round?: number;
}

export interface NoticeEvent extends AceEvent {
  type: 'notice';
  text: string;
}

export interface SessionStartEvent extends AceEvent {
  type: 'session_start';
  version: string;
  permission: string;
  sandbox: string;
  project_root: string;
  model?: string;
  mock?: boolean;
}

export interface ModelDeltaEvent extends AceEvent {
  type: 'model_delta';
  text: string;
}

/**
 * `status` 事件里的一个分段。
 *
 * 只有四个字段，且**没有样式**：引擎把 prompt_toolkit 的样式类名折算成了 `level`
 * （`context_badge` 的"颜色即语义"就是它），前端照它上色。
 *
 * `priority` 越小越先保留 —— 但"该丢谁"由前端按**自己的列数**决定
 * （与 `ui/ace_layout.fit_status_line` 同一条口径：同一份数据、两种排版）。
 */
export interface StatusSegmentWire {
  name: string;
  text: string;
  priority: number;
  /** `info` / `dim` / `warn` / `danger` / `goal` 之一（未知值当 info）。 */
  level: string;
}

export interface StatusEvent extends AceEvent {
  type: 'status';
  segments: StatusSegmentWire[];
}

/** 审批决策三态 —— 与 `agent_runner.GRANT_*` 一致。 */
export type GrantDecision = 'once' | 'session' | 'deny';

// ---------------------------------------------------------------- 主页

/**
 * 主页条目。字段全是 **i18n 键**（`label_key` / `hint_key`）而不是译文 ——
 * 这样 `/lang` 切了之后前端重渲染就跟着变，不必让引擎重发。
 *
 * `value` 是**当前值**（如「权限 readonly」里的 readonly）：主页一半的价值在
 * "现在是什么"，只写开关名而不写当前状态，用户还得去别处查。
 */
export interface HomeItem {
  action: string;
  label_key: string;
  value: string;
  hint_key: string;
  enabled: boolean;
  /**
   * 文案里的**占位符参数**（如「继续上次：{when}{turns} 轮」里的 `when`/`turns`）。
   *
   * 少了它前端只能把 `{when}` 原样打出来 —— 不报错，但读起来是残缺的。
   */
  fmt?: Record<string, string | number>;
}

export interface HomeSection {
  key: string;
  title_key: string;
  items: HomeItem[];
}

export interface HomeData {
  title: {
    version?: string;
    model?: string;
    permission?: string;
    sandbox?: string;
    folder?: string;
  };
  sections: HomeSection[];
}

// ---------------------------------------------------------------- 任务树

export interface TaskNodeData {
  text: string;
  status: string;
  note: string;
  children: TaskNodeData[];
}

export interface TasksData {
  /** `null` = 目标/待办/正在执行三样都空（调用方不该画空树）。 */
  tree: TaskNodeData | null;
  /** 空树时给的一句话（i18n 键）。 */
  empty_key?: string;
}

// ---------------------------------------------------------------- 历史会话

/** 一条可引用的历史会话（`@session` 菜单的候选）。 */
export interface SessionRow {
  path: string;
  when: string;
  turns: number;
  label: string;
}

export interface SessionsData {
  sessions: SessionRow[];
}

/** `initialize` 的返回（`ai_code._run_serve` 的 `_h_initialize`）。 */
export interface InitializeResult {
  protocol: number;
  server: { name: string; version: string };
  permission: string;
  sandbox: string;
  project_root: string;
  model?: string;
  mock?: boolean;
  stream?: boolean;
  methods?: string[];
  /** 命令名 → i18n 描述键（补全菜单用）。**发键不发译文**，前端自己查字典。 */
  commands?: Record<string, string>;
  /** 命令名 → 分组 i18n 键。 */
  command_groups?: Record<string, string>;
  /** vim 子集开关（`/vim` 可改；改完用 `config.request` 重读）。 */
  vim?: boolean;
  /**
   * 界面语言（`zh` / `en` / `ja`）—— 引擎当前用的那本字典。
   *
   * 前端**自己有一份字典**，所以起步要知道该用哪本：只认命令行 `--lang` 的话，
   * 配置里写了 `en` 也会是中文。切换时引擎还会发 `language` 事件（见 `AceEvent`）。
   */
  lang?: string;
  /**
   * 字形降级表 `{原字: 替身}`，只含**这台控制台画不出**的那些。
   *
   * 由引擎算（只有它知道控制台编码，Node 判断不了 legacy 编码）。空表 = 画得出全部。
   */
  glyphs?: Record<string, string>;
}

/**
 * `config.request` 的返回 —— **就是引擎的 `home_state()`**（加了 `vim`）。
 *
 * 为什么让它跟主页共用一份：菜单里那行「（当前 xxx）」与主页分区里的当前值必须是
 * **同一个答案**。各算各的必然会漂（主页说沙箱是 job、菜单说 off，用户不知道该信哪个）。
 */
/** `command.exec` 的回执。`keep_going: false` = 这一行之后引擎就结束了（`/exit`）。 */
export interface CommandResult {
  ok?: boolean;
  /** 缺省视为 true；**只有显式 false 才该退**（老引擎不带这个字段时不许误退）。 */
  keep_going?: boolean;
}

export interface ConfigData {
  /** `/fullscreen` 的引擎侧取值 —— 外壳据此进出备用屏（它才知道能不能进 1049）。 */
  fullscreen?: boolean;
  model?: string;
  permission?: string;
  sandbox?: string;
  effort?: string;
  net?: string;
  lang?: string;
  folder?: string;
  version?: string;
  vim?: boolean;
  [key: string]: unknown;
}
