/**
 * **工具审批弹窗**（迁入壳自己的那块）：引擎在 `permission.answer` 上阻塞等人，
 * 这个框弹出来时那边是真停着的——不答就一直等（引擎侧 600s 超时后 fail-close）。
 *
 * 三态与 ace 前端（`PermissionDialog.tsx`）同一契约：once / session / deny，
 * session 可带 `persist`（引擎按建议模式落持久规则，危险形状引擎自己拒）。
 * `persistOk=false` 时隐藏「记住」项——按了没反应的按钮是体验债。
 *
 * 纯展示：按键由 App 的 useInput 统一路由（数字/方向/回车/Esc），这里只画。
 * 视觉直接复用上游设计系统（`Pane` + 反显选中行 + dim 提示行）——照搬的意思
 * 就是能用他们的就用他们的，不另造一套。
 */

import React from 'react'

import { Text } from '../ui.js'
import { Pane } from '../components/design-system/Pane.js'
import { HintLine } from '../components/design-system/HintLine.js'

export interface PermissionDialogProps {
  tool: string
  reason: string
  persistOk?: boolean
}

export const SHELL_PERMISSION_OPTIONS: readonly {
  decision: 'once' | 'session' | 'deny'
  label: string
  persist: boolean
}[] = [
  { decision: 'once', label: '仅本次', persist: false },
  { decision: 'session', label: '本会话允许', persist: false },
  { decision: 'session', label: '记住并写规则', persist: true },
  { decision: 'deny', label: '拒绝', persist: false },
]

/** 展开后的选项表：`persistOk=false` 时去掉「记住」（调用方据此定按键数）。 */
export function shellPermissionOptions(
  persistOk: boolean | undefined,
): readonly typeof SHELL_PERMISSION_OPTIONS {
  return persistOk === false
    ? SHELL_PERMISSION_OPTIONS.filter((o) => !o.persist)
    : SHELL_PERMISSION_OPTIONS
}

export function PermissionDialog({
  tool,
  reason,
  persistOk,
  cursor,
}: PermissionDialogProps & { cursor: number }): React.ReactNode {
  const opts = shellPermissionOptions(persistOk)
  const safe = Math.max(0, Math.min(cursor, opts.length - 1))
  return (
    <Pane color="permission">
      <Text color="remember" bold>⚠ {tool} 需要你确认</Text>
      {reason !== '' ? <Text>{reason.slice(0, 200)}</Text> : null}
      {opts.map((o, i) => (
        <Text key={o.label} inverse={i === safe} bold={i === safe}
              color={o.decision === 'deny' ? 'red' : undefined}>
          {i === safe ? '❯ ' : '  '}{i + 1}. {o.label}
        </Text>
      ))}
      <HintLine text="↑/↓ 选择 · 回车确认 · Esc 拒绝" />
    </Pane>
  )
}
