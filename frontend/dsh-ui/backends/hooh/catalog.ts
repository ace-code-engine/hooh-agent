/**
 * HooH 内核的离线会话目录（v1）：ace 的会话历史在引擎进程里
 * （`.ace_sessions/` 是它自己的格式），跨进程浏览等 `/resume` 协议面
 * 接进 `open({kind:'resume'})` 再做。这里的空目录是**如实**的：
 * 返回空列表比编一份假数据诚实（词汇表的同一口径——缺能力就不发事件）。
 */
import type { SessionCatalog } from '../../agent/backend.js'

export function createHoohCatalog(): SessionCatalog {
  return {
    async list() {
      return []
    },
  }
}
