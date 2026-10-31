/**
 * 一条 HooH 引擎连接 = 一个 `AgentSession`（docs/agent-backend-design.md §3）：
 * 重放（本进程内看到的事件）、事件订阅、输入、取消、审批与提问应答、
 * 模型/强度/命令三个控制面。协议语义以 `core/ace_serve.py` 为唯一事实源。
 *
 * 状态机：starting → idle ⇄ running；审批/提问挂起 = requires-action。
 * 进程死亡：挂起轮次以 error 收尾、提示撤回、状态 disposed（幂等）。
 */
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentEventMeta, CommandInfo, PermissionRequestView } from '../../agent/events.js'
import type { AgentSessionRef } from '../../agent/refs.js'
import type { AgentInput, AgentSession, AgentSessionStatus, CancelCause, CancelReceipt, SubmitPlacement } from '../../agent/session.js'
import type { PermissionDecision, QuestionAnswers } from '../../agent/capabilities.js'
import type { WorkingActivityView } from '../../adapter/ports/channel-view.js'
import { HOOH_BACKEND_ID, HOOH_BACKEND_LABEL } from './contract.js'
import { HoohProcess, hoohChoicePayload, type HoohChoiceAction } from './process.js'
import { createHoohTranslator, type AceFrame } from './translate.js'

interface PendingPermissionRow {
  readonly request: PermissionRequestView
  settle(outcome: 'approved' | 'denied' | 'cancelled'): void
}

interface PendingQuestionRow {
  /** ace 的 kind（choose/confirm/text）——应答载荷按它投影。 */
  readonly kind: string
  readonly title: string
  readonly options: readonly string[]
  settle(): void
}

export interface HoohSessionOptions {
  readonly mock?: boolean
}

export async function openHoohSession(proc: HoohProcess, host: { debug(line: string): void }, options: HoohSessionOptions = {}): Promise<AgentSession> {
  const translator = createHoohTranslator()
  const ref: AgentSessionRef = { backendId: HOOH_BACKEND_ID, sessionId: `hooh-${randomUUID().slice(0, 8)}` }

  // ── 状态与账本 ────────────────────────────────────────────────────
  let status: AgentSessionStatus = 'starting'
  let disposed = false
  const historyEvents: AgentEvent[] = []
  const listeners = new Set<(batch: readonly AgentEvent[], meta: AgentEventMeta) => void>()
  const livePermissions = new Map<string, PendingPermissionRow>()
  const liveQuestions = new Map<string, PendingQuestionRow>()
  let init: Awaited<ReturnType<HoohProcess['initialize']>> | undefined
  let commandsCache: readonly CommandInfo[] | undefined
  let model = 'ace'
  let effort: string | undefined
  /** 宿主选择（引擎侧没有独立的 effort 往返，先本地记账 + 命令面驱动）。 */
  let localEffort: string | undefined
  const activityListeners = new Set<(view: WorkingActivityView) => void>()

  const setStatus = (next: AgentSessionStatus): void => {
    if (status === next || disposed || next === 'starting') return
    status = next
    emit([{ type: 'session.status', status: next }], { replay: false })
  }

  const emit = (events: readonly AgentEvent[], meta: AgentEventMeta): void => {
    if (events.length === 0) return
    if (meta.replay === false) historyEvents.push(...events)
    for (const listener of listeners) {
      try { listener(events, meta) } catch (error) { host.debug(`hooh session listener error: ${String(error)}`) }
    }
  }

  // ── 引擎事件帧 → AgentEvent ──────────────────────────────────────
  proc.onEvent((frame: AceFrame) => {
    const events = translator.translate(frame)
    if (events.length === 0) {
      // status 帧 → 活动行（引擎的分段状态；宿主没订阅就不留痕）。
      if (frame.type === 'status' && activityListeners.size > 0) {
        const segments = Array.isArray(frame.segments) ? frame.segments.map(s => String(s)) : []
        const now = Date.now()
        const view: WorkingActivityView = {
          phase: 'thinking',
          line: segments.join(' · '),
          live: false,
          toolCount: 0,
          phaseStartedAt: now,
          turnStartedAt: now,
          updatedAt: now,
          lang: 'zh',
        }
        for (const l of activityListeners) { try { l(view) } catch { /* 单个订阅者坏了不连坐 */ } }
      }
      return
    }
    // 审批/提问的挂起账本：request 事件登记（应答句柄挂 capability 上）。
    for (const ev of events) {
      if (ev.type === 'permission.request') {
        const row: PendingPermissionRow = {
          request: ev.request,
          settle: () => { livePermissions.delete(ev.request.requestId); if (livePermissions.size === 0 && liveQuestions.size === 0) setStatus('running') },
        }
        livePermissions.set(ev.request.requestId, row)
      } else if (ev.type === 'question.request') {
        const q = ev.request.questions[0]
        const kind = String((frame as Record<string, unknown>).kind ?? 'select')
        const options = kind === 'select' && Array.isArray((frame as Record<string, unknown>).options)
          ? ((frame as Record<string, unknown>).options as unknown[]).map(o => String(o))
          : []
        const row: PendingQuestionRow = {
          kind, title: q?.question ?? '', options,
          settle: () => { liveQuestions.delete(ev.request.requestId); if (livePermissions.size === 0 && liveQuestions.size === 0) setStatus('running') },
        }
        liveQuestions.set(ev.request.requestId, row)
      } else if (ev.type === 'permission.settled' || ev.type === 'question.settled') {
        setStatus('running')
      } else if (ev.type === 'session.ready') {
        model = ev.model
        effort = ev.effort
        init = undefined // 已初始化过就不再覆盖（initialize 的信息在下面）
      }
    }
    emit(events, { replay: false })
  })

  // ── 握手 ─────────────────────────────────────────────────────────
  try {
    init = await proc.initialize(true)
    if (init.model !== '') model = init.model
  } catch (error) {
    await proc.kill()
    throw error instanceof Error ? error : new Error(String(error))
  }
  emit([{
    type: 'session.ready',
    sessionId: ref.sessionId,
    cwd: init?.projectRoot ?? process.cwd(),
    model,
    permissionMode: init?.permission,
  }], { replay: false })
  setStatus('idle')

  // 进程死亡：轮次以 error 收尾 + disposed。
  void proc.onExit.then(({ code }) => {
    if (disposed) return
    disposed = true
    const tail: AgentEvent[] = []
    if (status === 'running') {
      tail.push({ type: 'turn.end', turn: translator.turn(), reason: { kind: 'error', message: `引擎进程退出（code=${code ?? 'null'}）` }, time: Date.now() })
    }
    for (const p of livePermissions.values()) p.settle('cancelled')
    for (const q of liveQuestions.values()) q.settle()
    tail.push({ type: 'session.status', status: 'disposed' })
    emit(tail, { replay: false })
  })

  // ── AgentSession ─────────────────────────────────────────────────
  const session: AgentSession = {
    ref,
    cwd: init?.projectRoot ?? process.cwd(),
    get status() { return status },
    capabilities: {
      permissions: {
        respond(requestId: string, decision: PermissionDecision): void {
          const row = livePermissions.get(requestId)
          if (row === undefined) return
          const aceDecision = decision.kind === 'reject' ? 'deny' : decision.kind === 'allow-always' ? 'session' : 'once'
          proc.send('permission.answer', { decision: aceDecision, ...(decision.kind === 'allow-always' ? { persist: true } : {}) })
          row.settle(decision.kind === 'reject' ? 'denied' : 'approved')
        },
        pending: () => [...livePermissions.values()].map(r => r.request),
      },
      questions: {
        respond(requestId: string, answers: QuestionAnswers): void {
          const row = liveQuestions.get(requestId)
          if (row === undefined) return
          const a = answers.answers[0]
          let action: HoohChoiceAction
          if (row.kind === 'confirm') {
            const picked = a?.selected?.[0]
            const label = picked !== undefined ? row.options[Number(picked)] : undefined
            action = label === '否' || label === 'No' || picked === '1'
              ? { type: 'deny' }
              : { type: 'accept' }
          } else if (row.kind === 'text') {
            action = { type: 'text', text: a?.custom ?? null }
          } else {
            const picked = a?.selected?.[0]
            const value = picked !== undefined ? row.options[Number(picked)] ?? picked : a?.custom
            action = value !== undefined ? { type: 'pick', value } : { type: 'cancel' }
          }
          proc.send('choice.answer', hoohChoicePayload(row.kind, action))
          row.settle()
        },
        cancel(requestId: string): void {
          const row = liveQuestions.get(requestId)
          if (row === undefined) return
          proc.send('choice.answer', hoohChoicePayload(row.kind, { type: 'cancel' }))
          row.settle()
        },
      },
      models: {
        list: async () => [{ id: model, label: model, description: 'HooH 引擎当前模型' }],
        current: () => ({ model }),
        set: async (refModel) => {
          await proc.request('command.exec', { line: `/model ${refModel.model}` })
          model = refModel.model
          return { kind: 'switched' }
        },
      },
      effort: {
        levelsAvailable: true,
        levels: () => ['auto', 'low', 'medium', 'high', 'max'].map(id => ({ id, label: id })),
        current: () => localEffort,
        set: async (id) => {
          if (id !== null && id !== '') await proc.request('command.exec', { line: `/effort ${id}` })
          localEffort = id ?? undefined
        },
      },
      commands: {
        list: async () => {
          if (commandsCache !== undefined) return commandsCache
          const commands = init?.commands ?? {}
          commandsCache = Object.entries(commands).map(([name, desc]) => ({
            name,
            description: typeof desc === 'string' ? desc : String((desc as { description?: unknown })?.description ?? ''),
          }))
          return commandsCache
        },
      },
      workingActivity: {
        subscribe(listener: (view: WorkingActivityView) => void): () => void {
          activityListeners.add(listener)
          return () => { activityListeners.delete(listener) }
        },
      },
      diagnostics: {
        lines: () => [
          `HooH engine: ${model}（protocol ${init?.protocol ?? '?'}）`,
          `serve methods: ${init?.methods.length ?? 0}`,
        ],
      },
      native: {},
    },
    async history(): Promise<readonly AgentEvent[]> {
      return [...historyEvents]
    },
    subscribe(listener: (batch: readonly AgentEvent[], meta: AgentEventMeta) => void): () => void {
      listeners.add(listener)
      // 迟到的订阅者：一次补齐全部已见事件（词汇表：重放与活流同词汇）。
      try { listener(historyEvents, { replay: true }) } catch { /* 单个订阅者 */ }
      return () => { listeners.delete(listener) }
    },
    async submit(input: AgentInput, placement: SubmitPlacement): Promise<{ readonly accepted: boolean; readonly reason?: string }> {
      if (disposed) return { accepted: false, reason: 'session disposed' }
      if (placement !== 'turn' && placement !== 'now') {
        return { accepted: false, reason: 'ace 引擎不支持排队（steer/followup）；稍后再发' }
      }
      setStatus('running')
      void proc.request('user.message', { text: input.text }).catch(error => {
        host.debug(`hooh submit failed: ${String(error)}`)
        emit([
          { type: 'notice', level: 'error', text: `引擎请求失败：${error instanceof Error ? error.message : String(error)}` },
          { type: 'turn.end', turn: translator.turn(), reason: { kind: 'error', message: String(error) }, time: Date.now() },
        ], { replay: false })
        setStatus('idle')
      })
      return { accepted: true }
    },
    async cancel(_cause: CancelCause): Promise<CancelReceipt> {
      if (disposed) return { stillQueued: [], outcome: 'confirmed' }
      proc.send('session.interrupt', {})
      // ace 在轮边界停下（不硬杀）；队列在宿主侧，confirmed 即空。
      return { stillQueued: [], outcome: 'confirmed' }
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      proc.kill()
      await proc.waitExit().catch(() => undefined)
      emit([{ type: 'session.status', status: 'disposed' }], { replay: false })
    },
  }
  void HOOH_BACKEND_LABEL // 标签经 manifest；这里只防未用告警
  return session
}
