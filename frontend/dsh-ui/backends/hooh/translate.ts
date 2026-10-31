/**
 * ace `--serve` 的 NDJSON 帧 ↔ Agent 领域事件词汇表的翻译器。
 *
 * ace 的事件词汇表见 `core/ace_events.py` 的 `EVENT_TYPES`（15 种）；
 * 这里把它映射到 `src/agent/events.ts` 的 `AgentEvent`。翻译是纯函数：
 * 输入一帧，输出 0..n 个事件——重放与活流走同一条路（词汇表的要求）。
 *
 * 序号契约：`seq` 单调递增并由我们维护（ace 帧自身不带全局 seq）；
 * `anchor` 用 ace 无原生锚点 ⇒ 以 `ace:<n>` 形态合成（rewind 不可用，
 * 该 capability 不声明）。`turn`/`step` 从 ace 的 `round`/`tool 段` 近似。
 */
import type { AgentEvent, AgentEventMeta } from '../../agent/events.js'

/** ace 引擎一帧事件（`core/ace_events.make_event` 的 JSON 形态）。 */
export interface AceFrame {
  readonly type: string
  readonly [key: string]: unknown
}

/** 转换器的可变序号账本（一个会话一个）。 */
export interface HoohTranslator {
  /** 一帧 → 0..n 个事件。 */
  translate(frame: AceFrame): readonly AgentEvent[]
  /** 当前回合号（ace `round` 语义最近似）。 */
  turn(): number
}

const str = (v: unknown): string => typeof v === 'string' ? v : ''
const bool = (v: unknown): boolean => v === true

export function createHoohTranslator(): HoohTranslator {
  let seq = 0
  let turnNo = 0
  let stepNo = 0
  let inTurn = false
  let attemptId = ''
  let deltaIndex = 0
  let streamOpen = false
  const next = (): number => ++seq
  const anchor = (): string => `ace:${seq}`

  const meta = (wake?: 'sync' | 'frame'): AgentEventMeta =>
    wake === undefined ? { replay: false } : { replay: false, wake }

  const out = (events: AgentEvent[], wake?: 'sync' | 'frame'): readonly AgentEvent[] => {
    void meta(wake)
    return events
  }

  return {
    turn: () => turnNo,
    translate(frame) {
      const events: AgentEvent[] = []
      const now = Date.now()
      switch (frame.type) {
        case 'session_start': {
          events.push({
            type: 'session.ready',
            sessionId: 'hooh-session',
            cwd: str(frame.project_root) || process.cwd(),
            model: str(frame.model) || 'ace',
            permissionMode: str(frame.permission) || undefined,
            backendVersion: str(frame.version) || undefined,
          })
          events.push({ type: 'session.status', status: 'idle' })
          break
        }
        case 'user_message': {
          if (!inTurn) {
            inTurn = true
            turnNo += 1
            stepNo = 0
            events.push({ type: 'turn.start', turn: turnNo, origin: 'user', time: now })
          }
          const s = next()
          events.push({
            type: 'user.message', id: `u${s}`, anchor: anchor(), seq: s, turn: turnNo,
            time: now, source: 'user', text: str(frame.text), blocks: [],
          })
          break
        }
        case 'model_request': {
          stepNo += 1
          attemptId = `a${next()}`
          deltaIndex = 0
          streamOpen = false
          events.push({ type: 'step.start', turn: turnNo, step: stepNo })
          break
        }
        case 'model_delta': {
          const text = str(frame.text)
          if (text === '') break
          if (!streamOpen) {
            streamOpen = true
            events.push({ type: 'assistant.attempt.start', attemptId, turn: turnNo, step: stepNo, firstTokenTime: now })
          }
          deltaIndex += 1
          events.push({
            type: 'assistant.delta', attemptId, index: deltaIndex, time: now,
            turn: turnNo, step: stepNo, delta: { kind: 'text', text },
          })
          return out(events, 'frame')
        }
        case 'tool_start':
        case 'tool_call': {
          // 工具卡开一张（ace 同名并发暂不存在；callId 用名字+序号保稳定）。
          const name = str(frame.tool)
          if (!streamOpen) {
            streamOpen = true
            events.push({ type: 'assistant.attempt.start', attemptId, turn: turnNo, step: stepNo, firstTokenTime: now })
          }
          events.push({
            type: 'assistant.delta', attemptId, index: ++deltaIndex, time: now,
            turn: turnNo, step: stepNo, delta: { kind: 'tool-args', callId: name, partialJson: JSON.stringify(frame.params ?? {}), name },
          })
          events.push({
            type: 'tool.call', seq: next(), turn: turnNo, step: stepNo,
            callId: name, name, argsJson: JSON.stringify(frame.params ?? {}), time: now,
          })
          break
        }
        case 'tool_result': {
          const name = str(frame.tool)
          const status = str(frame.status)
          const failed = /error|fail|denied|blocked|format/i.test(status)
          const message = str(frame.message)
          events.push({
            type: 'tool.result', seq: next(), turn: turnNo, step: stepNo,
            callId: name, isError: failed, time: now,
            content: [{ type: 'text', text: message }], text: message,
            ...(failed ? { errorText: message } : {}),
          })
          break
        }
        case 'permission_request': {
          events.push({ type: 'session.status', status: 'requires-action' })
          events.push({
            type: 'permission.request',
            request: {
              requestId: `perm:${next()}`,
              toolName: str(frame.tool) || 'tool',
              displayName: str(frame.tool) || undefined,
              reason: str(frame.reason) || undefined,
              // 词汇表：选项必须自己给（宿主不补默认）。ace 的审批就是
              // 一次性放行/会话记住/拒绝三选；reject 在前（防误触）。
              options: [
                { id: 'deny', kind: 'reject' },
                { id: 'once', kind: 'allow-once' },
                ...(frame.persist_ok !== false ? [{ id: 'session', kind: 'allow-always' as const }] : []),
              ],
              suppressAlwaysAllow: frame.persist_ok === false,
              defaultToNo: true,
            },
          })
          break
        }
        case 'choice_request': {
          // 结构化提问：ace 的 choose/confirm/text 三种 kind 都折成一个单问题
          // 的 question.request（QuestionItemView 形状）；应答在 session.ts。
          const kind = frame.kind === 'confirm' || frame.kind === 'text' ? String(frame.kind) : 'select'
          const options = Array.isArray(frame.options) ? frame.options.map(o => String(o)) : []
          const secret = bool(frame.secret)
          events.push({ type: 'session.status', status: 'requires-action' })
          events.push({
            type: 'question.request',
            request: {
              requestId: `choice:${next()}`,
              questions: [{
                question: str(frame.title),
                ...(kind === 'text' && secret ? { purpose: 'auth' as const } : {}),
                options: kind === 'select'
                  ? options.map(label => ({ label }))
                  : [],
                // confirm/text 无候选行：只走自定义输入行（hideCustomInput 关）。
              }],
            },
          })
          break
        }
        case 'final': {
          if (streamOpen) {
            events.push({ type: 'assistant.attempt.end', attemptId, outcome: 'committed', turn: turnNo, step: stepNo })
            streamOpen = false
          }
          events.push({
            type: 'assistant.message', seq: next(), anchor: anchor(), turn: turnNo, step: stepNo,
            attemptId, time: now, blocks: [{ type: 'text', text: str(frame.text) }], canonical: true,
          })
          break
        }
        case 'session_end': {
          if (streamOpen) {
            events.push({ type: 'assistant.attempt.end', attemptId, outcome: 'abandoned' })
            streamOpen = false
          }
          if (inTurn) {
            inTurn = false
            events.push({ type: 'turn.end', turn: turnNo, reason: { kind: 'completed' }, time: now })
          }
          events.push({ type: 'session.status', status: 'idle' })
          break
        }
        case 'notice': {
          events.push({ type: 'notice', level: 'info', text: str(frame.text) })
          break
        }
        case 'status': {
          // ace 的分段状态行 → 活动指示（tool.output 级别太吵，走 notice 的
          // 上游会重复；这里不折事件——上游 workingActivity 能力接它，见 session.ts）
          break
        }
        default:
          break
      }
      return out(events)
    },
  }
}
