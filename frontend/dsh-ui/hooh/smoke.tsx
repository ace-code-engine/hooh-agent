/**
 * **无头 smoke**：把这棵迁入的树在我们仓库里**渲染出来**，不靠真 TTY。
 *
 * 为什么先做这个：第 ③ 步的成败标准是"跑得起来"，不是"tsc 干净"（第三方类型子集
 * 的等式差异我们不追，见 `MIGRATION.md`）。这个脚本用假 stdio 喂给**它们自己的**渲染器
 * （`ink/root.js` 的 `renderSync`），把帧打出来 —— 于是"迁进来的 UI 能不能画"这件事
 * 在 CI/无终端环境里也能验。
 *
 * 跑法（在 `frontend/` 下）：
 *   node node_modules/tsx/dist/cli.mjs dsh-ui/hooh/smoke.tsx
 */

import React from 'react'
import { EventEmitter } from 'node:events'

import { Launchpad } from '../screens/Launchpad.js'
import { renderSync } from '../ink/root.js'
import { launchpadData, type AceSnapshot } from './adapter.js'

const SNAP: AceSnapshot = {
  version: '1.1.0',
  model: 'deepseek-v4-flash',
  permission: 'readonly',
  cwd: 'G:\\AI_Project\\ace',
  effort: 'max',
  preset: 'code',
  lastSessionTitle: '把 dsh-TUI 的 UI 迁到 ace 这边',
  commands: ['/help', '/model', '/permission', '/resume', '/status', '/tools'].map((name) => ({
    name: name.slice(1), description: name, replacement: name, commandLine: name,
  })),
}

const CONTROL = /\u001b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g
const hasVisible = (s: string): boolean => s.replace(CONTROL, '').trim() !== ''

class FakeOut extends EventEmitter {
  columns = 100
  rows = 30
  isTTY = false
  frames: string[] = []
  write = (chunk: string): boolean => {
    this.frames.push(chunk)
    return true
  }
  ref(): void {}
  unref(): void {}
  lastFrame(): string {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (hasVisible(this.frames[i]!)) return this.frames[i]!
    }
    return this.frames[this.frames.length - 1] ?? ''
  }
}

/**
 * 假 stdin：**必须继承 `EventEmitter`** —— 它们的 App 用 `addListener('readable', …)`
 * 订阅输入（第一版我只写了 `on/off/removeListener`，渲染出来是一屏
 * `stdin.addListener is not a function` 的 error boundary）。
 */
class FakeIn extends EventEmitter {
  isTTY = true
  private buf: string | null = null
  write = (d: string): void => {
    this.buf = d
    this.emit('readable')
  }
  read = (): string | null => {
    const b = this.buf
    this.buf = null
    return b
  }
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

const stdout = new FakeOut()
const stdin = new FakeIn()

const data = launchpadData(SNAP)
const instance = renderSync(
  React.createElement(Launchpad, {
    ...data,
    query: '',
    focusIndex: -1,
    isTerminalFocused: true,
    fontId: undefined,
    onStarClick: undefined,
    overlayPanel: undefined,
    onParamPick: () => {},
    onCommandPick: () => {},
    onOpenWorkspace: () => {},
    onFocusChange: () => {},
    onAction: () => {},
    onQueryChange: () => {},
    onSubmit: () => {},
    onEscape: () => {},
    onBlankClick: () => {},
  } as never),
  { stdout, stdin, exitOnCtrlC: false, patchConsole: false, terminalImages: false } as never,
)

setTimeout(() => {
  const frame = stdout.lastFrame()
  const plain = frame.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  console.log('=== 迁入的 Launchpad 渲染结果（宽 100）===')
  const lines = plain.split('\n')
  lines.forEach((l: string, i: number) => console.log(String(i).padStart(3) + '|' + l.replace(/\s+$/, '')))
  console.log('=== 共 %d 行 · 首帧字节 %d ===', lines.length, frame.length)
  try { instance.unmount() } catch { /* 无头下卸载失败不影响判读 */ }
  process.exit(lines.length > 3 ? 0 : 1)
}, 400)
