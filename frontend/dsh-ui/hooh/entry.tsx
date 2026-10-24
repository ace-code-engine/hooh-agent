/**
 * **HooH × 迁入的 dsh-TUI UI：真入口**（第 ④ 步）。
 *
 * `ace ui [一句话]` 跑的就是这个：起一个**常驻**引擎会话，把迁入的那套界面
 * （首屏 Launchpad → 聊天页 MessageList）挂上去，转录来自 ace 的引擎事件。
 *
 * 环境：
 *   · `ACE_PROJECT_ROOT`  引擎的工作目录（默认当前目录）—— 会话日志落它的 `.ace_sessions/`
 *   · `ACE_PERMISSION`    readonly（默认）/ write / full
 *   · `ACE_MOCK=1`        离线演示（不需要密钥）
 *   · `ACE_PYTHON`        用哪个解释器起引擎（默认按前端的 `resolvePython()` 找）
 */

import React from 'react'
import { basename } from 'node:path'

import { App } from './App.js'
import { render } from '../ui.js'
import { openEngine } from './engine.js'
import type { AceSnapshot } from './adapter.js'

/** 从环境读快照；读不到的字段退回中性默认值（不编造一个假的模型名/权限档）。 */
function snapshot(): AceSnapshot {
  const env = process.env
  return {
    version: env.ACE_VERSION ?? '1.1.0',
    model: env.ACE_MODEL ?? 'deepseek-v4-flash',
    permission: env.ACE_PERMISSION ?? 'readonly',
    cwd: env.ACE_PROJECT_ROOT ?? process.cwd(),
    effort: env.ACE_EFFORT ?? 'max',
    preset: env.ACE_PRESET ?? 'code',
    ...(env.ACE_LAST_SESSION ? { lastSessionTitle: env.ACE_LAST_SESSION } : {}),
    commands: ['/help', '/model', '/permission', '/resume', '/status', '/tools'],
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  // 自我标识：两个壳的启动画面都印 HooH，用户（和报错栈里的 dsh-ui 路径）分不清
  // 自己进了哪个。stderr 一行说清楚 —— 走 stderr 而不是 stdout：stdout 是画面。
  console.error('[HooH × dsh-TUI 壳]（ace ui）正在启动引擎…')
  const prompt = argv.filter((a) => !a.startsWith('-')).join(' ').trim()
  const engine = await openEngine({
    projectRoot: snapshot().cwd,
    prompt,
    mock: process.env.ACE_MOCK === '1',
    ...(process.env.ACE_PERMISSION ? { permission: process.env.ACE_PERMISSION } : {}),
  })
  const app = render(
    React.createElement(App, {
      snapshot: snapshot(),
      engine,
      ...(prompt ? { initialPrompt: prompt } : {}),
    }),
  )
  await app.waitUntilExit?.()
  engine.close()
}

// 直接运行本文件时才挂（被 import 时只导出，便于无头测试）。
// 判据用 **basename 相等**：`endsWith('entry.tsx')` 会误匹配 `smoke-entry.tsx`
// （那个脚本于是被挂两次，第二次用真 process.stdin，在管道里直接 raw-mode 报错）。
if (process.argv[1] && basename(process.argv[1]) === 'entry.tsx') {
  void main(process.argv.slice(2))
}
