/**
 * **HooH × 迁入的 dsh-TUI UI：常驻界面**。
 *
 * 形状与上游一致：**没有对话时 = 首屏（Launchpad），有对话时 = 转录（MessageList）+ 输入行**。
 * 差别只在数据源 —— 转录来自 ace 的引擎事件（`engine.ts` 的行构造器），
 * 不是 DSH 的会话日志。
 *
 * 日常驱动的三根线（2026-10-24，切默认入口前补齐）：
 *   1. **流式**：事件到一条投影一条（重算式——全量事件从头投影，顺序即事件序），
 *      `model_delta` 接进最近的流式助手行，`final` 就地定格；
 *   2. **命令路由**：`/` 开头走 `command.exec`（user.message 会把 "/model x"
 *      当聊天文本喂给模型），可见输出以 notice 事件回流、同一套行投影；
 *   3. **审批**：`permission_request` 是**独立于轮次**的往返（引擎阻塞等人），
 *      专用回调接走 → `PermissionDialog` → `permission.answer`；
 *      `choice_request`（选择面板未接入）如实自动取消，不让引擎挂死。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Box, Text, useInput } from '../ui.js'

/** 渲染异常边界：把渲染错误写到 stderr，而不是让 ink 静默退出（静默退出 =
 *  冻结画面 = 用户看到「卡死」而没人知道为什么）。 */
class ShellErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err }
  }
  componentDidCatch(err: Error): void {
    try {
      process.stderr.write('[HooH 壳] 渲染异常：' + (err.stack ?? String(err)) + String.fromCharCode(10))
    } catch { /* noop */ }
  }
  render(): React.ReactNode {
    if (this.state.err !== null) {
      return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { color: 'red' }, '✗ 界面渲染异常（详见上方 stderr）'),
        React.createElement(Text, { color: 'gray' }, String(this.state.err.message ?? this.state.err)),
      )
    }
    return this.props.children
  }
}
import { MessageList } from '../components/MessageList.js'
import { Launchpad } from '../screens/Launchpad.js'
import { launchpadData, type AceSnapshot } from './adapter.js'
import {
  rowsFromEvents,
  type AceEngine,
  type AceEvent,
  type PendingChoice,
  type PendingPermission,
  type UiRow,
} from './engine.js'
import { PermissionDialog, shellPermissionOptions } from './PermissionDialog.js'
import { ChoiceDialog } from './ChoiceDialog.js'

export interface AppProps {
  snapshot: AceSnapshot
  /** 引擎会话；不传就只有首屏（无头测试/降级用）。 */
  engine?: AceEngine | undefined
  /** 起来就先发一句（`ace ui "问题"` / 无头 smoke 用）。 */
  initialPrompt?: string | undefined
}

export function App({ snapshot, engine, initialPrompt }: AppProps): React.ReactElement {
  const data = useMemo(() => launchpadData(snapshot), [snapshot])
  const [rows, setRows] = useState<UiRow[]>([])
  const [query, setQuery] = useState('')
  const [focusIndex, setFocusIndex] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [perm, setPerm] = useState<PendingPermission | null>(null)
  const [permCursor, setPermCursor] = useState(0)
  // 选择/确认/文本（/model、/config 向导都走这条）：req 本体 + 每种的交互态。
  const [choice, setChoice] = useState<PendingChoice | null>(null)
  const [choiceCursor, setChoiceCursor] = useState(0)
  const [choiceText, setChoiceText] = useState('')
  // 全量事件账本：每条事件到达后**从头重投影**（顺序即事件序；TUI 规模的
  // 重算成本可忽略），行状态永远与引擎一致，不需要增量修补逻辑。
  const eventsRef = useRef<AceEvent[]>([])
  const started = useRef(false)

  const reproject = useCallback((): void => {
    setRows(rowsFromEvents(eventsRef.current))
  }, [])
  // 流式节流：每条 model_delta 都全量重投影 + 全树重渲染是卡顿主因——
  // 100ms 合帧；收尾（turn/command 完成）走 reproject 立即 flush。
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reprojectThrottled = useCallback((): void => {
    if (throttleRef.current !== null) return
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null
      setRows(rowsFromEvents(eventsRef.current))
    }, 100)
  }, [])
  const reprojectNow = useCallback((): void => {
    if (throttleRef.current !== null) {
      clearTimeout(throttleRef.current)
      throttleRef.current = null
    }
    setRows(rowsFromEvents(eventsRef.current))
  }, [])

  // 审批与选择都是轮次外的往返：注册在挂载期，不挂在某一次 turn 上。
  useEffect(() => {
    if (!engine) return
    const offPerm = engine.onPermission((req) => {
      setPerm(req)
      setPermCursor(0)
    })
    const offChoice = engine.onChoice((req) => {
      setChoice(req)
      setChoiceCursor(0)
      setChoiceText(req.default ?? '')
    })
    return () => { offPerm(); offChoice() }
  }, [engine])

  const answer = useCallback(
    (decision: 'once' | 'session' | 'deny', persist: boolean): void => {
      engine?.answerPermission(decision, persist)
      setPerm(null)
    },
    [engine],
  )

  const submit = useCallback(
    async (text: string): Promise<void> => {
      const line = text.trim()
      if (line === '' || busy) return
      setQuery('')
      if (!engine) return
      setBusy(true)
      try {
        if (line.startsWith('/')) {
          // 命令：引擎不回放用户行，自己补一条（与轮次的回放同一形状）。
          eventsRef.current = [...eventsRef.current, { type: 'user_message', text: line }]
          reproject()
          const res = await engine.command(line, (ev) => {
            eventsRef.current = [...eventsRef.current, ev]
            reprojectThrottled()
          })
          // `/exit` 等命令以 keep_going=false 收工（引擎侧已保存会话）。
          if (!res.keepGoing) process.exit(0)
        } else {
          // 轮次：引擎自己回放 user_message（延迟本地进程级，可接受）——
          // 不做乐观插入，行状态保持单一来源（全量事件投影）。
          await engine.turn(line, (ev) => {
            eventsRef.current = [...eventsRef.current, ev]
            reprojectThrottled()
          })
        }
        reprojectNow()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        eventsRef.current = [...eventsRef.current, { type: 'notice', text: `✗ ${msg}` }]
        reprojectNow()
      } finally {
        setBusy(false)
      }
    },
    [busy, engine, reproject],
  )

  // 首屏动作 → ace 命令映射。上游动作表用的是 DSH 的命令词表（launchpadActions
  // 的 command 字段），ace 侧同名命令只有一部分——按词表映射，没有对应物的
  // 动作如实进一条 notice，绝不假装点了没反应。
  const ACTION_CMD: Record<string, string> = {
    continue: 'resume',
    settings: 'config',
    jobs: 'tasks',
    help: 'help',
  }
  const runAction = useCallback(
    (action: { id: string; labelKey: string; command: string }): void => {
      const cmd = ACTION_CMD[action.command]
      if (cmd !== undefined) void submit('/' + cmd)
      else {
        eventsRef.current = [...eventsRef.current, {
          type: 'notice', text: `（动作「${action.command}」在 ace 侧没有对应命令）`,
        }]
        reproject()
      }
    },
    [submit, reproject],
  )

  // 参数段铭牌（模型/强度/预设/权限）点击 → 打开对应命令（裸命令会输出当前值
  // 与用法，作为 notice 行可见）。
  const PARAM_CMD: Record<string, string> = {
    model: 'model', effort: 'effort', preset: 'preset', permission: 'permission',
  }
  const runParam = useCallback(
    (segment: 'model' | 'effort' | 'preset' | 'permission'): void => {
      void submit('/' + (PARAM_CMD[segment] ?? segment))
    },
    [submit],
  )

  useEffect(() => {
    if (started.current || !initialPrompt || !engine) return
    started.current = true
    void submit(initialPrompt)
  }, [initialPrompt, engine, submit])

  useInput((input, key) => {
    // 审批优先，选择次之：弹窗在场时所有键归它（busy 与否无关——它们正挂在轮次中间）。
    if (perm !== null) {
      const opts = shellPermissionOptions(perm.persistOk)
      if (key.upArrow) setPermCursor((c) => (c - 1 + opts.length) % opts.length)
      else if (key.downArrow) setPermCursor((c) => (c + 1) % opts.length)
      else if (key.escape) answer('deny', false)
      else if (key.return) {
        const o = opts[permCursor] ?? opts[0]!
        answer(o.decision, o.persist)
      } else {
        const idx = '1234'.indexOf(input)
        if (idx >= 0 && idx < opts.length) {
          const o = opts[idx]!
          answer(o.decision, o.persist)
        }
      }
      return
    }
    if (choice !== null) {
      if (choice.kind === 'choose' && choice.options !== undefined) {
        const n = choice.options.length
        if (key.upArrow) setChoiceCursor((c) => (c - 1 + n) % n)
        else if (key.downArrow) setChoiceCursor((c) => (c + 1) % n)
        else if (key.escape) { engine?.answerChoice('choose', { type: 'cancel' }); setChoice(null) }
        else if (key.return) {
          engine?.answerChoice('choose', { type: 'pick', value: choice.options[choiceCursor] ?? '' })
          setChoice(null)
        } else {
          const idx = '123456789'.indexOf(input)
          if (idx >= 0 && idx < n) {
            engine?.answerChoice('choose', { type: 'pick', value: choice.options[idx]! })
            setChoice(null)
          }
        }
      } else if (choice.kind === 'confirm') {
        if (input === 'y' || input === 'Y' || key.return) {
          engine?.answerChoice('confirm', { type: 'accept' }); setChoice(null)
        } else if (input === 'n' || input === 'N' || key.escape) {
          engine?.answerChoice('confirm', { type: 'deny' }); setChoice(null)
        } else if (key.upArrow || key.downArrow) {
          setChoiceCursor((c) => 1 - c)
        }
      } else if (choice.kind === 'text') {
        if (key.escape) {
          engine?.answerChoice('text', { type: 'text', text: null }); setChoice(null)
        } else if (key.return) {
          engine?.answerChoice('text', { type: 'text', text: choiceText })
          setChoice(null)
        } else if (key.backspace || key.delete) {
          setChoiceText((t) => t.slice(0, -1))
        } else if (input && input >= ' ' && input !== '\u007f') {
          setChoiceText((t) => t + input)
        }
      }
      return
    }
    if (rows.length === 0) {
      // 首屏（Launchpad）的打字/提交由**上游自己的输入处理**负责——它带剪贴板、
      // 命令候选、焦点环整套；App 层在这里若再吃一遍按键就是双份输入
      // （同一键两层各处理一次，2026-10-24「输不了任何东西」的根因之一）。
      // App 层只保留：弹窗（上面）与挂起轮次的中断（下面）。
      if (busy && (key.escape || (key.ctrl && input === 'c'))) {
        engine?.interrupt()
        setBusy(false)
      }
      return
    }
    if (busy) {
      // 挂住的轮次必须能被放弃（钱在烧：杀窗重试=再烧一次）。Esc/Ctrl+C 请求
      // 引擎在轮边界停下；本地同时解除 busy 锁——引擎收尾事件晚到也照常投影。
      if (key.escape || (key.ctrl && input === 'c')) {
        engine?.interrupt()
        setBusy(false)
      }
      return
    }
    if (key.escape) {
      if (query !== '') setQuery('')
      else process.exit(0)
      return
    }
    if (key.return) {
      void submit(query)
      return
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1))
      return
    }
    if (input && input >= ' ' && input !== '\u007f') setQuery((q) => q + input)
  })

  if (rows.length === 0) {
    return (
      <ShellErrorBoundary>
      <Launchpad
        {...data}
        query={query}
        cursorOffset={query.length}
        focusIndex={focusIndex}
        isTerminalFocused
        fontId={undefined}
        onStarClick={undefined}
        overlayPanel={undefined}
        onParamPick={(s) => runParam(s)}
        onCommandPick={(commandLine) => {
          const line = commandLine.startsWith('/') ? commandLine : '/' + commandLine
          void submit(line)
        }}
        onOpenWorkspace={() => {
          // 上游这个名字牌开 /workspace 工作区菜单；ace 侧最接近的是会话选择。
          eventsRef.current = [...eventsRef.current, {
            type: 'notice', text: '（工作区菜单未接入——切会话用 /resume）',
          }]
          reproject()
        }}
        onFocusChange={setFocusIndex}
        onAction={runAction}
        onQueryChange={setQuery}
        onSubmit={(t) => void submit(t)}
        onEscape={() => process.exit(0)}
        onBlankClick={() => setFocusIndex(-1)}
      />
      </ShellErrorBoundary>
    )
  }

  return (
    <ShellErrorBoundary>
    <Box flexDirection="column">
      <MessageList
        rows={rows as never}
        expanded={false}
        expandedRows={new Set<number>()}
        selectedId={null}
        onToggleRow={() => {}}
        model={snapshot.model}
        showAll
        onToggleAll={() => {}}
      />
      {perm !== null ? (
        <PermissionDialog
          tool={perm.tool}
          reason={perm.reason}
          persistOk={perm.persistOk}
          cursor={permCursor}
          onPickIndex={(i) => {
            const o = shellPermissionOptions(perm.persistOk)[i]
            if (o !== undefined) answer(o.decision, o.persist)
          }}
        />
      ) : null}
      {choice !== null ? (
        <ChoiceDialog
          req={choice}
          cursor={choiceCursor}
          value={choiceText}
          onPick={(i) => {
            if (choice.kind === 'choose' && choice.options !== undefined) {
              engine?.answerChoice('choose', { type: 'pick', value: choice.options[i] ?? '' })
              setChoice(null)
            } else if (choice.kind === 'confirm') {
              engine?.answerChoice('confirm', i === 0 ? { type: 'accept' } : { type: 'deny' })
              setChoice(null)
            }
          }}
        />
      ) : null}
      {perm === null && choice === null ? (
        <Box marginTop={1}>
          <Text color="accent">{busy ? '… ' : '❯ '}</Text>
          <Text>{query}</Text>
        </Box>
      ) : null}
    </Box>
    </ShellErrorBoundary>
  )
}
