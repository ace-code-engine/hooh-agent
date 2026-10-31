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
import { appendFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { App } from './App.js'
import { render } from '../ui.js'
import { openEngine } from './engine.js'
import type { AceSnapshot } from './adapter.js'

/** 仓库根（本文件在 `frontend/dsh-ui/hooh/`）。**绝对路径**——ace.cmd 是 pushd
 *  frontend 之后起壳的，`process.cwd()` 是 frontend，拿它当项目根会让引擎的
 *  cwd 变成 frontend/frontend（不存在），spawn 直接死（2026-10-24 说话没回应）。 */
const REPO = join(import.meta.dirname, '..', '..', '..')

/** 从环境读快照；读不到的字段退回中性默认值（不编造一个假的模型名/权限档）。 */
function snapshot(): AceSnapshot {
  const env = process.env
  return {
    version: env.ACE_VERSION ?? '1.1.0',
    model: env.ACE_MODEL ?? 'deepseek-v4-flash',
    permission: env.ACE_PERMISSION ?? 'write',
    cwd: env.ACE_PROJECT_ROOT ?? REPO,
    effort: env.ACE_EFFORT ?? 'max',
    preset: env.ACE_PRESET ?? 'code',
    ...(env.ACE_LAST_SESSION ? { lastSessionTitle: env.ACE_LAST_SESSION } : {}),
    // 形状必须是上游 CommandCompletion（{name, description, replacement,
    // commandLine}，name 不带斜杠）：CommandSuggestions 对每条取
    // stringWidth(c.name)，喂字符串当场炸渲染（2026-10-24 一按 / 就闪退的根因）；
    // 0.17.0 起 palette 还要 replacement/commandLine 才能回填完整命令行。
    commands: [
      { name: 'help', description: 'Show available commands', replacement: '/help', commandLine: '/help' },
      { name: 'model', description: 'Show or switch the model', replacement: '/model', commandLine: '/model' },
      { name: 'permission', description: 'Show or change the permission level', replacement: '/permission', commandLine: '/permission' },
      { name: 'resume', description: 'Continue a saved session', replacement: '/resume', commandLine: '/resume' },
      { name: 'status', description: 'Show session status', replacement: '/status', commandLine: '/status' },
      { name: 'tools', description: 'List available tools', replacement: '/tools', commandLine: '/tools' },
      { name: 'effort', description: 'Show or change reasoning effort', replacement: '/effort', commandLine: '/effort' },
      { name: 'exit', description: 'Quit HooH', replacement: '/exit', commandLine: '/exit' },
    ],
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  // 自我标识：两个壳的启动画面都印 HooH，用户（和报错栈里的 dsh-ui 路径）分不清
  // 自己进了哪个。stderr 一行说清楚 —— 走 stderr 而不是 stdout：stdout 是画面。
  console.error('[HooH × dsh-TUI 壳]（ace ui）正在启动引擎…')
  const prompt = argv.filter((a) => !a.startsWith('-')).join(' ').trim()
  // 延迟起引擎：ink 初始化（raw mode 等）与引擎 spawn 叠在同一窗口时，
  // 引擎会在 ~400ms 被外部终止（code=null，faulthandler 静默 = 非 Python 崩溃，
  // 成因未明——WP-DSH-SHELL 在查）。先让 UI 稳定落一帧再起引擎，绕开这个
  // 启动窗口；首屏本来就是「正在启动引擎…」的状态。
  await new Promise((r) => setTimeout(r, 1200))
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
  // 孤儿防护：窗口被叉掉/进程被杀时，引擎子进程必须跟着死——否则一个挂着
  // 真模型轮次的引擎在后台继续烧钱，而没有人看得见它。正常退出走下面的
  // waitUntilExit → engine.close()；这里兜**非正常**退出。
  const cleanup = (): void => {
    if (process.env.ACE_SHELL_DEBUG === '1') {
      try {
        appendFileSync(
          join(REPO, 'frontend', '.shell-debug.log'),
          new Date().toISOString().slice(11, 23) + ' CLEANUP engine.close' + String.fromCharCode(10),
        )
      } catch { /* noop */ }
    }
    engine.close()
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
  // 0.17.0：render 返回 Promise<Instance>，waitUntilExit 在 resolve 出来的实例上。
  const instance = await app
  await instance.waitUntilExit()
  if (process.env.ACE_SHELL_DEBUG === '1') {
    try {
      appendFileSync(
        join(REPO, 'frontend', '.shell-debug.log'),
        new Date().toISOString().slice(11, 23) + ' INK_EXITED (waitUntilExit resolved)' + String.fromCharCode(10),
      )
    } catch { /* noop */ }
  }
  engine.close()
}

// 直接运行本文件时才挂（被 import 时只导出，便于无头测试）。
// 判据用 **basename 相等**：`endsWith('entry.tsx')` 会误匹配 `smoke-entry.tsx`
// （那个脚本于是被挂两次，第二次用真 process.stdin，在管道里直接 raw-mode 报错）。
if (process.argv[1] && basename(process.argv[1]) === 'entry.tsx') {
  main(process.argv.slice(2)).catch((e) => {
    console.error('[HooH 壳] 主流程异常退出：', e?.stack ?? String(e))
    process.exit(1)
  })
}
