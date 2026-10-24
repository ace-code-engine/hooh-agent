/**
 * **ace 引擎 → dsh-ui 能吃的会话事件**（A 方案第 ③ 步的核心那一层）。
 *
 * 数据流（一次真跑）：
 *
 *   `python ai_code.py --serve`（引擎的 NDJSON 协议，与 Ink 前端同一套）
 *        ↓  这个文件：起进程、发 `user.message`、收事件
 *   `{type, data}` 形状的 **DSH 会话事件**（`user/message` / `assistant/message` / …）
 *        ↓  上游自己的投影器（不改）
 *   `projectDshSessionEventsToSnapshots(events, meta)` → 信道快照（含 transcript 行）
 *        ↓  上游自己的组件（不改）
 *   `MessageList` / `Chat`
 *
 * **为什么映射要由我们写**：ace 的事件词表（`core/ace_events.py`）与 DSH 的
 * （`KNOWN_DSH_EVENT_TYPES`）是两套。它们是"同一件事的两种说法"，这一层就是词典。
 * 上游那套投影器一行都不用改 —— 这正是"迁到我们自己这边"而不是"改它的代码"。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolvePython } from '../../src/protocol/client.js'

/** 仓库根（本文件在 `frontend/dsh-ui/hooh/`）。 */
const REPO = join(import.meta.dirname, '..', '..', '..')

/** ace 的一条事件（`core/ace_events.py` 的 `EVENT_TYPES`）。 */
export interface AceEvent {
  type: string
  [k: string]: unknown
}

/** DSH 的会话事件形状：`{type, data}`，必要时带顶层 `ignorable`。 */
export interface DshEvent {
  type: string
  data?: Record<string, unknown>
  ignorable?: boolean
}

export interface EngineOptions {
  /** ace 的工作目录（**必须**给对：会话日志落在它的 `.ace_sessions/`）。 */
  projectRoot: string
  /** 想说的话。 */
  prompt: string
  /** 离线演示（不需要密钥）。 */
  mock?: boolean
  /** 权限档；默认 readonly（无人在旁边答审批时最安全）。 */
  permission?: string
  /** 一轮上限（毫秒）。 */
  timeoutMs?: number
}

/**
 * 起一个 `--serve` 引擎、跑一轮、把事件收全。
 *
 * 一条会话一个进程：ace 的上下文在进程内（messages / 执行层 / 审计都在里面），
 * 所以这里**不重放历史** —— 一次调用 = 一轮。
 */
export async function runAceTurn(opts: EngineOptions): Promise<AceEvent[]> {
  const py = process.env.ACE_PYTHON || resolvePython()
  const entry = join(REPO, 'ai_code.py')
  if (!existsSync(entry)) throw new Error('找不到引擎入口: ' + entry)

  const args = [entry, '--serve', '--project-root', opts.projectRoot,
                '--permission', opts.permission ?? 'readonly']
  if (opts.mock === true) args.push('--mock')          // 默认**不** mock：真入口走真模型

  const child = spawn(py, args, {
    cwd: opts.projectRoot,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ACE_NO_ANIM: '1' },
    stdio: ['pipe', 'pipe', 'ignore'],
  })

  const events: AceEvent[] = []
  let buf = ''
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('引擎一轮超时')), opts.timeoutMs ?? 120_000)
    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        nl = buf.indexOf('\n')
        if (!line) continue
        let frame: Record<string, unknown>
        try { frame = JSON.parse(line) as Record<string, unknown> } catch { continue }
        if (frame.type === 'event') {
          const ev = frame.event as AceEvent | undefined
          if (ev && typeof ev.type === 'string') {
            events.push(ev)
            // `final` 之后引擎还会回一条 resp；给它一点时间把尾巴收完
            if (ev.type === 'final') {
              setTimeout(() => { clearTimeout(timer); resolve() }, 50)
            }
          }
        } else if (frame.type === 'resp' && frame.ok === false) {
          clearTimeout(timer)
          reject(new Error(JSON.stringify(frame.error ?? {})))
        }
      }
    })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.stdin.write(JSON.stringify({ v: 1, type: 'req', id: '1', method: 'initialize',
                                       params: { protocol: 1, stream: false } }) + '\n')
    child.stdin.write(JSON.stringify({ v: 1, type: 'req', id: '2', method: 'user.message',
                                       params: { text: opts.prompt } }) + '\n')
  })

  try {
    await done
  } finally {
    try { child.kill() } catch { /* 已经退出 */ }
  }
  return events
}

/** 一轮的原始事件 → 界面的转录行（`ChatRow` 是上游的形状，见 `adapter/ports/channel-view.ts:71`）。 */
export interface UiRow {
  id: number
  kind: 'user' | 'assistant' | 'tool' | 'notice'
  text: string
  streaming?: boolean
  tool?: {
    callId: string
    name: string
    argsText: string
    status: 'running' | 'ok' | 'error'
    resultText?: string
    errorText?: string
    startedAt: number
    durationMs?: number
  }
}

/**
 * **ace 事件 → 转录行**。
 *
 * 上游自己的投影器（`session-projection.ts`）只把 `user/message` 与 `assistant/message`
 * 折成行 —— 那条路够做"能看"的转录；**工具卡与通知要我们自己造行**，因为它们的
 * 行模型（`ToolRow`）本来就是宿主侧（DSH）填的，没有对应的事件投影。
 *
 * 工具行的配对规则：`tool_result` 认它**前面最近一个同名且还在 running** 的 `tool_call`
 * （ace 的事件序保证如此；同名并发目前不存在）。
 */
export function rowsFromEvents(events: readonly AceEvent[], startId = 1): UiRow[] {
  const rows: UiRow[] = []
  let next = startId
  const push = (r: Omit<UiRow, 'id'>): void => { rows.push({ id: next++, ...r }) }

  for (const ev of events) {
    switch (ev.type) {
      case 'user_message':
        push({ kind: 'user', text: String(ev.text ?? '') })
        break
      case 'notice':
        push({ kind: 'notice', text: String(ev.text ?? '') })
        break
      case 'model_delta': {
        // 流式：增量接到**最近的流式助手行**上（没有就开一行）。重算式管线
        // （每条事件从头投影）保证这里改的就是本轮最终行——顺序即事件序。
        const t = String(ev.text ?? '')
        const last = rows[rows.length - 1]
        if (last && last.kind === 'assistant' && last.streaming === true) {
          last.text += t
        } else {
          push({ kind: 'assistant', text: t, streaming: true })
        }
        break
      }
      case 'final': {
        // final = 本轮全文：若尾行还是流式行，就地定格（不另起一行）；
        // 否则（无流式握手的老引擎）按旧行为另起。
        const text = String(ev.text ?? '')
        const last = rows[rows.length - 1]
        if (last && last.kind === 'assistant' && last.streaming === true) {
          last.text = text
          last.streaming = false
        } else {
          push({ kind: 'assistant', text })
        }
        break
      }
      case 'tool_call': {
        const name = String(ev.tool ?? '')
        const params = (ev.params ?? {}) as Record<string, unknown>
        push({
          kind: 'tool',
          text: name,
          tool: {
            callId: name + '#' + next,
            name,
            argsText: JSON.stringify(params),
            status: 'running',
            startedAt: Date.now(),
          },
        })
        break
      }
      case 'tool_result': {
        const name = String(ev.tool ?? '')
        const status = String(ev.status ?? 'ok')
        const failed = /error|fail|denied|blocked|FORMAT/i.test(status)
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i]!
          if (row.kind === 'tool' && row.tool?.name === name && row.tool.status === 'running') {
            const elapsed = Number(ev.elapsed ?? 0)
            row.tool = {
              ...row.tool,
              status: failed ? 'error' : 'ok',
              resultText: String(ev.message ?? ''),
              ...(failed ? { errorText: String(ev.message ?? '') } : {}),
              ...(elapsed > 0 ? { durationMs: Math.round(elapsed * 1000) } : {}),
            }
            break
          }
        }
        break
      }
      default:
        break
    }
  }
  return rows
}

/** 审批请求（引擎在 `permission.answer` 上**阻塞等答案**——不答就挂到超时）。 */
export interface PendingPermission {
  tool: string
  reason: string
  /** 引擎说这次不适配「记住并写规则」（外发/组合命令/危险包装）→ 隐藏记住项。 */
  persistOk: boolean
}

/** 选择/确认/文本请求（`/model`、`/config` 向导、拒绝理由…都走这一条往返）。 */
export interface PendingChoice {
  kind: 'choose' | 'confirm' | 'text'
  title: string
  /** choose 专有：候选文本列表。 */
  options?: string[]
  /** text 专有：默认值（空输入=用它）。 */
  default?: string
  /** text 专有：凭据输入（界面上不回显）。 */
  secret?: boolean
}

export type ChoiceAction =
  | { type: 'pick'; value: string }
  | { type: 'accept' }
  | { type: 'deny' }
  | { type: 'text'; text: string | null }
  | { type: 'cancel' }

/** 投影到 `choice.answer` 的载荷（纯函数；协议口径在 core/ace_serve 的三个 _ask）。 */
export function choiceAnswerPayload(kind: string, action: ChoiceAction): Record<string, unknown> {
  if (kind === 'confirm') return { accepted: action.type === 'accept' }
  if (kind === 'text') {
    // 空串 = 取消（引擎按「没拿到答案」处理，向导落回默认值）——发 null。
    if (action.type === 'text' && action.text !== null && action.text !== '') {
      return { text: action.text }
    }
    return { text: null }
  }
  // choose：values 缺失/空 = 取消
  return action.type === 'pick' ? { values: [action.value] } : {}
}

/** 常驻引擎会话：一个进程活到会话结束（`--serve` 的上下文在进程内）。 */
export class AceEngine {
  private child: ReturnType<typeof spawn>
  private buf = ''
  private seq = 0
  private id = 0
  private listeners = new Set<(ev: AceEvent) => void>()
  private waiters = new Map<string, () => void>()
  private permissionCb: ((req: PendingPermission) => void) | null = null
  private choiceCb: ((req: PendingChoice) => void) | null = null

  constructor(private opts: EngineOptions) {
    const py = process.env.ACE_PYTHON || resolvePython()
    const args = [join(REPO, 'ai_code.py'), '--serve',
                  '--project-root', opts.projectRoot,
                  '--permission', opts.permission ?? 'write']
    if (opts.mock === true) args.push('--mock')        // 默认真模型；只有测试/离线演示才 mock
    this.child = spawn(py, args, {
      cwd: opts.projectRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', ACE_NO_ANIM: '1' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    this.child.stdout.setEncoding('utf-8')
    this.child.stdout.on('data', (chunk: string) => this.feed(chunk))
  }

  private feed(chunk: string): void {
    this.buf += chunk
    let nl = this.buf.indexOf('\n')
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      nl = this.buf.indexOf('\n')
      if (!line) continue
      let frame: Record<string, unknown>
      try { frame = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (frame.type === 'event') {
        const ev = frame.event as AceEvent | undefined
        if (ev && typeof ev.type === 'string') {
          // 审批与选择是**独立于轮次**的往返：审批挂起时模型停着等人，必须由
          // 专门的回调接走（进了 turn 的 collected 也没人答，引擎挂到超时）。
          if (ev.type === 'permission_request') {
            this.permissionCb?.({
              tool: String(ev.tool ?? ''),
              reason: String(ev.reason ?? ''),
              persistOk: ev.persist_ok !== false,
            })
          } else if (ev.type === 'choice_request') {
            // 选择/确认/文本（/model /config 向导都走这条）。有面板回调就交面板；
            // 没有则如实自动取消——静默挂着引擎比取消更糟。
            const req: PendingChoice = {
              kind: (ev.kind === 'confirm' || ev.kind === 'text' ? ev.kind : 'choose'),
              title: String(ev.title ?? ''),
              ...(Array.isArray(ev.options)
                ? { options: (ev.options as unknown[]).map((o) => String(o)) }
                : {}),
              ...(ev.default !== undefined ? { default: String(ev.default) } : {}),
              ...(ev.secret === true ? { secret: true } : {}),
            }
            if (this.choiceCb !== null) {
              this.choiceCb(req)
            } else {
              this.write('choice.answer', { text: null, values: [] }, 'choice' + String(++this.id))
              this.listeners.forEach((fn) => fn({
                type: 'notice', text: `（引擎请求选择：面板未接入，已自动取消——${req.title}）`,
              }))
            }
          } else {
            this.listeners.forEach((fn) => fn(ev))
          }
          if (ev.type === 'final') {
            const done = [...this.waiters.values()][0]
            done?.()
          }
        }
      } else if (frame.type === 'resp') {
        const id = String(frame.id ?? '')
        this.waiters.get(id)?.()
      }
    }
  }

  /** 注册审批回调（返回去注册函数）。审批请求**独立于轮次**到达。 */
  onPermission(cb: ((req: PendingPermission) => void) | null): () => void {
    this.permissionCb = cb
    return () => { if (this.permissionCb === cb) this.permissionCb = null }
  }

  /** 回答审批。`persist: true` = 引擎按建议模式落一条持久规则（WP-AGENCY 刀3）。 */
  answerPermission(decision: 'once' | 'session' | 'deny', persist = false): void {
    const params: Record<string, unknown> = { decision }
    if (persist && decision === 'session') params.persist = true
    this.write('permission.answer', params, 'perm' + String(++this.id))
  }

  /** 注册选择回调（返回去注册函数）。`/model`、`/config` 向导都走这条往返。 */
  onChoice(cb: ((req: PendingChoice) => void) | null): () => void {
    this.choiceCb = cb
    return () => { if (this.choiceCb === cb) this.choiceCb = null }
  }

  /** 回答选择（载荷投影见 `choiceAnswerPayload`）。 */
  answerChoice(kind: string, action: ChoiceAction): void {
    this.write('choice.answer', choiceAnswerPayload(kind, action), 'choice' + String(++this.id))
  }

  /**
   * 斜杠命令走 `command.exec`（**不是** user.message——那条路会把 "/model x"
   * 当聊天文本喂给模型）。命令的可见输出以 `notice` 事件回流，走同一套行投影。
   */
  async command(line: string): Promise<{ keepGoing: boolean }> {
    const id = String(++this.seq)
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60_000)
      this.waiters.set(id, () => { clearTimeout(timer); resolve() })
    })
    this.write('command.exec', { line }, id)
    await done
    return { keepGoing: true }
  }

  /** 跑一轮；`onEvent` 每来一条事件回调一次（流式画界面用）。返回这一轮的**全部**事件。 */
  async turn(text: string, onEvent?: (ev: AceEvent) => void): Promise<AceEvent[]> {
    const collected: AceEvent[] = []
    const id = String(++this.seq)
    const listener = (ev: AceEvent): void => { collected.push(ev); onEvent?.(ev) }
    this.listeners.add(listener)
    const finished = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.opts.timeoutMs ?? 120_000)
      this.waiters.set(id, () => { clearTimeout(timer); resolve() })
    })
    this.write('user.message', { text }, id)
    await finished
    this.listeners.delete(listener)
    this.waiters.delete(id)
    return collected
  }

  private write(method: string, params: Record<string, unknown>, id: string): void {
    this.child.stdin.write(JSON.stringify(
      { v: 1, type: 'req', id, method, params }) + '\n')
  }

  /** 握手：告诉引擎"我是协议前端、要流式"（`core/ace_serve` 的 initialize）。 */
  async handshake(): Promise<void> {
    this.write('initialize', { protocol: 1, stream: true }, '0')
    await new Promise((r) => setTimeout(r, 300))
  }

  close(): void {
    try { this.child.kill() } catch { /* 已经退出 */ }
  }
}

/** 起一个会话并完成握手。 */
export async function openEngine(opts: EngineOptions): Promise<AceEngine> {
  const engine = new AceEngine(opts)
  await engine.handshake()
  return engine
}

export function toDshEvents(events: readonly AceEvent[]): DshEvent[] {
  const out: DshEvent[] = []
  for (const ev of events) {
    switch (ev.type) {
      case 'session_start':
        out.push({ type: 'turn/start', data: {} })
        break
      case 'user_message':
        out.push({ type: 'user/message', data: { message: { text: String(ev.text ?? '') } } })
        break
      case 'final':
        out.push({ type: 'assistant/message', data: { message: { text: String(ev.text ?? '') } } })
        break
      case 'session_end':
        out.push({ type: 'turn/end', data: {} })
        break
      default:
        break            // 工具/审批/通知：本轮的投影器不折行，留给后续（Chat 那条路）
    }
  }
  return out
}
