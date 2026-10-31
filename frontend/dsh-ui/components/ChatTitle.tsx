import React from 'react'
import { useTerminalTitle } from '../ink/hooks/use-terminal-title.js'

const FRAMES = ['⠂', '⠐']

/**
 * Keep terminal-title ticks out of the transcript's render owner.
 *
 * HooH 迁移：标签题带上我们的名字（上游打的是 `🐋 <title>`——标签栏里那个
 * 蓝色鲸鱼 emoji 的来源）。`互` 是产品名，工作时的转轮仍在；空闲时也写一次，
 * 不再让上一次工作的标题挂在整个会话期。
 */
export function ChatTitle({ title, working, focused }: {
  title: string
  working: boolean
  focused: boolean
}): null {
  const [frame, setFrame] = React.useState(0)
  React.useEffect(() => {
    if (!working || !focused) return
    const interval = setInterval(() => setFrame(value => (value + 1) % FRAMES.length), 960)
    return () => clearInterval(interval)
  }, [working, focused])
  useTerminalTitle(`${working ? FRAMES[frame] : '✦'} HooH · ${title}`)
  return null
}
