/**
 * **常驻 App 的无头 smoke**：真引擎跑一轮，然后把 `App`（首屏 → 聊天页）渲出来。
 *
 * 跑法：node node_modules/tsx/dist/cli.mjs dsh-ui/hooh/smoke-app.tsx
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

const CONTROL = /\u001b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g

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
  const root = mkdtempSync(join(tmpdir(), 'hooh-app-'))
  const engine = await openEngine({ projectRoot: root, prompt: '', mock: true })
  const snap: AceSnapshot = {
    version: HOOH_UI_VERSION, model: 'deepseek-v4-flash', permission: 'readonly', cwd: root,
    effort: 'max', preset: 'code',
    commands: ['/help', '/model'].map((name) => ({
      name: name.slice(1), description: name, replacement: name, commandLine: name,
    })),
  }

  const stdout = new FakeOut()
  const instance = renderSync(React.createElement(App, {
    snapshot: snap, engine, initialPrompt: '用一句话说明这个工作区是干什么的',
  }), { stdout, stdin: new FakeIn(), exitOnCtrlC: false, patchConsole: false, terminalImages: false } as never)

  await new Promise((r) => setTimeout(r, 6000))       // 等一轮跑完并重画
  engine.close()
  const frame = stdout.frames.join('').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  console.log('=== 常驻 App 渲染（首屏提交后 = 转录页）===')
  frame.split('\n').slice(-40).forEach((l, i) => console.log(String(i).padStart(3) + '|' + l.replace(/\s+$/, '')))
  const hasUser = frame.includes('用一句话说明这个工作区是干什么的')
  const hasAnswer = /●\s+\S/.test(frame)
  console.log('=== 有我的提问: %s · 有引擎回答: %s ===', hasUser, hasAnswer)
  try { instance.unmount() } catch { /* 无头下卸载失败不影响判读 */ }
  process.exit(hasUser && hasAnswer ? 0 : 1)
}

main().catch((e) => { console.error('smoke-app 失败:', e); process.exit(2) })
