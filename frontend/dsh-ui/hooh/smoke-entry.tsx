/**
 * **入口的无头 smoke**：`entry.tsx` 的 App 用假 stdio 渲染（先看首屏，再跑一轮看转录）。
 *
 * 为什么走子进程而不是在 vitest 里 import：我们的 `frontend/tsconfig.json` 只 include
 * `src/test/tools`，**故意不含这棵迁入的树**（见 `MIGRATION.md`）。测试文件一旦
 * `import '../dsh-ui/...'`，tsc 会顺着 import 把整棵树拉进严格编译 —— 我们自己的门禁
 * 反而红了（实测 exit 2）。所以三个 smoke 一律走子进程。
 *
 * 跑法：node node_modules/tsx/dist/cli.mjs dsh-ui/hooh/smoke-entry.tsx
 */

// **第一条 import**：在 i18n 求值之前把界面语言钉成 zh（见 smoke-lang.ts）。
import './smoke-lang.js'

import React from 'react'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { App } from './App.js'
import { renderSync } from '../ink/root.js'
import { openEngine } from './engine.js'
import { HOOH_UI_VERSION } from './version.js'
import type { AceSnapshot } from './adapter.js'

class FakeOut extends EventEmitter {
  columns = 100
  rows = 30
  isTTY = false
  frames: string[] = []
  write = (c: string): boolean => { this.frames.push(c); return true }
  ref(): void {}
  unref(): void {}
}

class FakeIn extends EventEmitter {
  isTTY = true
  read = (): string | null => null
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'hooh-entry-'))
  const stdout = new FakeOut()
  const snap: AceSnapshot = {
    version: HOOH_UI_VERSION, model: 'deepseek-v4-flash', permission: 'readonly', cwd: root,
    effort: 'max', preset: 'code',
    commands: ['/help'].map((name) => ({
      name: name.slice(1), description: name, replacement: name, commandLine: name,
    })),
  }

  // ① 首屏（还没接引擎）
  const first = renderSync(React.createElement(App, { snapshot: snap }),
    { stdout, stdin: new FakeIn(), exitOnCtrlC: false, patchConsole: false, terminalImages: false } as never)
  await new Promise((r) => setTimeout(r, 300))
  const splash = stdout.frames.join('').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  try { first.unmount() } catch { /* 无头 */ }
  console.log('=== ① 首屏 ===')
  splash.split('\n').forEach((l, i) => console.log(String(i).padStart(3) + '|' + l.replace(/\s+$/, '')))

  // ② 接上引擎跑一轮 → 转录页
  const out2 = new FakeOut()
  const engine = await openEngine({ projectRoot: root, prompt: '', mock: true })
  const second = renderSync(React.createElement(App, {
    snapshot: snap, engine, initialPrompt: '现在几点了',
  }), { stdout: out2, stdin: new FakeIn(), exitOnCtrlC: false, patchConsole: false, terminalImages: false } as never)
  await new Promise((r) => setTimeout(r, 5000))
  engine.close()
  const chat = out2.frames.join('').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  console.log('=== ② 转录页（引擎跑完一轮）===')
  chat.split('\n').slice(-24).forEach((l, i) => console.log(String(i).padStart(3) + '|' + l.replace(/\s+$/, '')))
  try { second.unmount() } catch { /* 无头 */ }

  const ok = splash.includes('说点什么') && chat.includes('现在几点了') && /●\s+\S/.test(chat)
  console.log('=== 首屏画了: %s · 转录有我的问题: %s · 有引擎回答: %s ===',
    splash.includes('说点什么'), chat.includes('现在几点了'), /●\s+\S/.test(chat))
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('smoke-entry 失败:', e); process.exit(2) })
