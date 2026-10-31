/**
 * **端到端 smoke（第 ③ 步的验收）**：真跑一轮 ace 引擎 → 上游投影器 → 上游转录组件。
 *
 * 这条链上**没有一步是我们瞎编的**：
 *   · 引擎进程真起、真发 `user.message`、真收事件（`hooh/engine.ts`）；
 *   · 事件 → DSH 事件的词典是我们写的（两套词表的对应关系）；
 *   · 投影与渲染**全走上游代码**（`projectDshSessionEventsToSnapshots` + `MessageList`）。
 *
 * 跑法（在 `frontend/` 下）：
 *   node node_modules/tsx/dist/cli.mjs dsh-ui/hooh/smoke-chat.tsx
 */

// **第一条 import**：在 i18n 求值之前把界面语言钉成 zh（见 smoke-lang.ts）。
// 这条 fixture 画的 MessageList 也会走 i18n（工具卡标题等），不钉就跟宿主 locale 漂。
import './smoke-lang.js'

import React from 'react'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MessageList } from '../components/MessageList.js'
import { renderSync } from '../ink/root.js'
import { projectDshSessionEventsToSnapshots } from '../adapter/channel/session-projection.js'
import { runAceTurn, toDshEvents } from './engine.js'

const CONTROL = /\u001b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
const hasVisible = (s: string): boolean => s.replace(CONTROL, '').trim() !== ''

class FakeOut extends EventEmitter {
  columns = 100
  rows = 30
  isTTY = false
  frames: string[] = []
  write = (chunk: string): boolean => { this.frames.push(chunk); return true }
  ref(): void {}
  unref(): void {}
  lastFrame(): string {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (hasVisible(this.frames[i]!)) return this.frames[i]!
    }
    return this.frames[this.frames.length - 1] ?? ''
  }
}

class FakeIn extends EventEmitter {
  isTTY = true
  private buf: string | null = null
  write = (d: string): void => { this.buf = d; this.emit('readable') }
  read = (): string | null => { const b = this.buf; this.buf = null; return b }
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

/** 上游投影行的最小 `ChatRow`（上游在 `adapter/channel/projection.ts:30` 也是这么拼的）。 */
interface Row { id: number; kind: string; text: string; folded: boolean; restored: boolean }

async function main(): Promise<void> {
  // 工作目录用临时目录：**不许**往仓库的 .ace_sessions/ 里写（H-26 的教训）
  const root = mkdtempSync(join(tmpdir(), 'hooh-dshui-'))
  const prompt = '用一句话说明这个工作区是干什么的'
  const aceEvents = await runAceTurn({ projectRoot: root, prompt, mock: true })
  const dshEvents = toDshEvents(aceEvents)
  console.log('=== 引擎事件 %d 条 → DSH 事件 %d 条 ===', aceEvents.length, dshEvents.length)

  const snapshots = projectDshSessionEventsToSnapshots(dshEvents, {
    channelId: 'ace', sessionTitle: 'HooH', homeDir: root,
    model: 'deepseek-v4-flash', pathCaseInsensitive: process.platform === 'win32',
  } as never)
  const last = snapshots[snapshots.length - 1] as unknown as { state: { transcript: Row[] } }
  const raw = last?.state?.transcript ?? []
  const rows: Row[] = raw.map((r, i) => ({
    id: i + 1, kind: r.kind, text: r.text, folded: false, restored: false,
  }))
  console.log('=== 投影出的转录行 %d 条 ===', rows.length)
  for (const r of rows) console.log('   ' + r.kind.padEnd(10) + r.text.slice(0, 60))

  const stdout = new FakeOut()
  const instance = renderSync(
    React.createElement(MessageList, {
      rows, expanded: false, expandedRows: new Set<number>(), selectedId: null,
      onToggleRow: () => {}, model: 'deepseek-v4-flash', showAll: true, onToggleAll: () => {},
    } as never),
    { stdout, stdin: new FakeIn(), exitOnCtrlC: false, patchConsole: false, terminalImages: false } as never,
  )

  await new Promise((r) => setTimeout(r, 400))
  const plain = stdout.lastFrame().replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  console.log('=== 上游 MessageList 渲染（宽 100）===')
  plain.split('\n').forEach((l, i) => console.log(String(i).padStart(3) + '|' + l.replace(/\s+$/, '')))
  try { instance.unmount() } catch { /* 无头下卸载失败不影响判读 */ }
  process.exit(rows.length >= 2 ? 0 : 1)
}

main().catch((e) => { console.error('smoke-chat 失败:', e); process.exit(2) })
