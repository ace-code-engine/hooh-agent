/**
 * **HooH × 迁入的 dsh-TUI UI：常驻界面**。
 *
 * 形状与上游一致：**没有对话时 = 首屏（Launchpad），有对话时 = 转录（MessageList）+ 输入行**。
 * 差别只在数据源 —— 转录来自 ace 的引擎事件（`engine.ts` 的行构造器），
 * 不是 DSH 的会话日志。
 *
 * 为什么不是直接渲染上游那个 `Chat`：它要 `channel: Channel`（DSH 的宿主服务对象，
 * 含 session/llm/tools/commands/settings/plugins 几十项）。那是第 ③ 步剩下的活；
 * 这一版先把**引擎 → 转录 → 它们自己的转录组件**这条链做成常驻的、能用的。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Box, Text, useInput } from '../ui.js'
import { MessageList } from '../components/MessageList.js'
import { Launchpad } from '../screens/Launchpad.js'
import { launchpadData, type AceSnapshot } from './adapter.js'
import { rowsFromEvents, type AceEngine, type UiRow } from './engine.js'

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
  const nextId = useRef(1)
  const started = useRef(false)

  const submit = useCallback(
    async (text: string): Promise<void> => {
      const line = text.trim()
      if (line === '' || busy) return
      setQuery('')
      const id = nextId.current++
      setRows((prev) => [...prev, { id, kind: 'user', text: line }])
      if (!engine) return
      setBusy(true)
      try {
        const events = await engine.turn(line)
        // 引擎会把用户那句也作为 `user_message` 回播 —— 丢掉它（我们已经自己插了一行），
        // 否则同一句话在界面上出现两次。
        const fresh = rowsFromEvents(events.filter((e) => e.type !== 'user_message'), nextId.current)
        nextId.current += fresh.length
        setRows((prev) => [...prev, ...fresh])
      } finally {
        setBusy(false)
      }
    },
    [busy, engine],
  )

  useEffect(() => {
    if (started.current || !initialPrompt || !engine) return
    started.current = true
    void submit(initialPrompt)
  }, [initialPrompt, engine, submit])

  useInput((input, key) => {
    if (busy) return                      // 忙时不吃键（中断走 Ctrl+C）
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
      <Box marginTop={1}>
        <Text color="accent">{busy ? '… ' : '❯ '}</Text>
        <Text>{query}</Text>
      </Box>
    </Box>
  )
}
