/**
 * **选择/确认/文本弹窗**（引擎 `choice_request` 的界面）：`/model`、`/config`
 * 向导、拒绝理由……凡是引擎的 `choose()` / `confirm()` / `ask_text()` 都走这条
 * 往返——引擎在 `choice.answer` 上阻塞等人，这个框弹出来时那边是真停着的。
 *
 * 三种 kind 的按键语义（App 的 useInput 统一路由，这里只画）：
 * - `choose`：↑/↓/数字候选，回车选中（P-10：选项外自填由引擎收）；
 * - `confirm`：y/回车=是，n/Esc=否（默认否——关掉不等于同意）；
 * - `text`：直接打字，回车提交；空串=取消（引擎落回默认值）；`secret` 不回显。
 *
 * 视觉复用上游设计系统（Pane + 反显选中 + dim 提示），与 PermissionDialog 同款。
 */

import React from 'react'

import { Text } from '../ui.js'
import { Pane } from '../components/design-system/Pane.js'
import { HintLine } from '../components/design-system/HintLine.js'
import type { PendingChoice } from './engine.js'

export function ChoiceDialog({
  req,
  cursor,
  value,
}: {
  req: PendingChoice
  cursor: number
  /** text 专用：已输入的文本（secret 时调用方传同长度的 • 串）。 */
  value?: string | undefined
}): React.ReactNode {
  return (
    <Pane color="permission">
      <Text color="remember" bold>{req.title}</Text>
      {req.kind === 'choose' && req.options !== undefined ? (
        req.options.map((o, i) => (
          <Text key={o} inverse={i === cursor} bold={i === cursor}>
            {i === cursor ? '❯ ' : '  '}{i + 1}. {o}
          </Text>
        ))
      ) : null}
      {req.kind === 'confirm' ? (
        <>
          <Text inverse={cursor === 0} bold={cursor === 0}>
            {cursor === 0 ? '❯ ' : '  '}1. 是
          </Text>
          <Text inverse={cursor === 1} bold={cursor === 1} color={cursor === 1 ? 'red' : undefined}>
            {cursor === 1 ? '❯ ' : '  '}2. 否
          </Text>
        </>
      ) : null}
      {req.kind === 'text' ? (
        <Text>
          <Text color="remember">❯ </Text>
          <Text>{req.secret === true ? '•'.repeat((value ?? '').length) : (value ?? '')}</Text>
          <Text dimColor>▌</Text>
        </Text>
      ) : null}
      {req.kind === 'choose' ? <HintLine text="↑/↓ 选择 · 回车确认 · Esc 取消" /> : null}
      {req.kind === 'confirm' ? <HintLine text="y/回车=是 · n/Esc=否（默认否）" /> : null}
      {req.kind === 'text' ? (
        <HintLine text={req.secret === true ? '回车提交 · Esc 取消（输入不回显）' : '回车提交 · 空回车/Esc 取消（落回默认值）'} />
      ) : null}
    </Pane>
  )
}
