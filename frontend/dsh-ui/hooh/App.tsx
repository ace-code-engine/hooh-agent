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
import { MessageList } from '../components/MessageList.js'
import { Launchpad } from '../screens/Launchpad.js'
import { launchpadData, type AceSnapshot } from './adapter.js'
import {
  rowsFromEvents,
  type AceEngine,
  type AceEvent,
  type PendingPermission,
  type UiRow,
} from './engine.js'
import { PermissionDialog, shellPermissionOptions } from './PermissionDialog.js'

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
  // 全量事件账本：每条事件到达后**从头重投影**（顺序即事件序；TUI 规模的
  // 重算成本可忽略），行状态永远与引擎一致，不需要增量修补逻辑。
  const eventsRef = useRef<AceEvent[]>([])
  const started = useRef(false)

  const reproject = useCallback((): void => {
    setRows(rowsFromEvents(eventsRef.current))
  }, [])

  // 审批是轮次外的往返：注册在挂载期，不挂在某一次 turn 上。
  useEffect(() => {
    if (!engine) return
    return engine.onPermission((req) => {
      setPerm(req)
      setPermCursor(0)
    })
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
          await engine.command(line)
        } else {
          // 轮次：引擎自己回放 user_message（延迟本地进程级，可接受）——
          // 不做乐观插入，行状态保持单一来源（全量事件投影）。
          await engine.turn(line, (ev) => {
            eventsRef.current = [...eventsRef.current, ev]
            reproject()
          })
        }
        reproject()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        eventsRef.current = [...eventsRef.current, { type: 'notice', text: `✗ ${msg}` }]
        reproject()
      } finally {
        setBusy(false)
      }
    },
    [busy, engine, reproject],
  )

  useEffect(() => {
    if (started.current || !initialPrompt || !engine) return
    started.current = true
    void submit(initialPrompt)
  }, [initialPrompt, engine, submit])

  useInput((input, key) => {
    // 审批优先：弹窗在场时所有键归它（busy 与否无关——审批正挂在轮次中间）。
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
    if (busy) return                      // 忙时不吃键（审批已在上面接管）
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
      <Launchpad
        {...data}
        query={query}
        cursorOffset={query.length}
        focusIndex={focusIndex}
        isTerminalFocused
        fontId={undefined}
        onStarClick={undefined}
        overlayPanel={undefined}
        onParamPick={() => {}}
        onCommandPick={() => {}}
        onOpenWorkspace={() => {}}
        onFocusChange={setFocusIndex}
        onAction={() => {}}
        onQueryChange={setQuery}
        onSubmit={(t) => void submit(t)}
        onEscape={() => process.exit(0)}
        onBlankClick={() => setFocusIndex(-1)}
      />
    )
  }

  return (
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
        />
      ) : (
        <Box marginTop={1}>
          <Text color="accent">{busy ? '… ' : '❯ '}</Text>
          <Text>{query}</Text>
        </Box>
      )}
    </Box>
  )
}
