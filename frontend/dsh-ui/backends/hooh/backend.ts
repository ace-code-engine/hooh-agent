/**
 * HooH 内核（docs/design/DSH-SHELL-TRACKING.md 的"整壳换 dsh-TUI"路线）：
 * 探测、开会话（create/resume 都落 create——ace 的会话上下文在引擎进程内，
 * 恢复由引擎自己的 `.ace_sessions/` 承担，v1 不跨进程 resume）、离线目录。
 *
 * 一个 `open()` = 一个 `ai_code.py --serve` 进程 + 一条 NDJSON 连接；
 * 引擎事件经 translate.ts 进 AgentEvent 词汇表，输入/审批/提问经
 * process.ts 的请求面回去。会话协议语义都在 session.ts。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentBackend, BackendDetection, BackendHost, OpenTarget } from '../../agent/backend.js'
import type { AgentSession } from '../../agent/session.js'
import { HOOH_BACKEND_ID, HOOH_BACKEND_LABEL } from './contract.js'
import { hoohEngineEntry, resolveHoohPython, HoohProcess } from './process.js'
import { openHoohSession } from './session.js'
import { createHoohCatalog } from './catalog.js'

/** `detect()`：不真正拉起引擎——入口在、解释器可执行就算装好（open 才 spawn）。 */
export async function detectHooh(host: BackendHost): Promise<BackendDetection> {
  const entry = hoohEngineEntry()
  if (!existsSync(entry)) {
    return { installed: false, hint: 'HooH 引擎入口不存在（ai_code.py）' }
  }
  let version: string | undefined
  try {
    version = process.env.HOOH_VERSION ?? undefined
  } catch { /* 读不到就罢了 */ }
  return { installed: true, auth: 'ok', version }
}

/** 宿主 cwd → 引擎 cwd（宿主给的是字符串路径，直接用）。 */
function engineCwd(target: OpenTarget, host: BackendHost): string {
  return target.cwd !== '' ? target.cwd : host.cwd
}

export const hoohBackend: AgentBackend = {
  id: HOOH_BACKEND_ID,
  descriptor: { label: HOOH_BACKEND_LABEL },
  detect: detectHooh,
  async open(target: OpenTarget, host: BackendHost): Promise<AgentSession> {
    const proc = new HoohProcess({
      cwd: engineCwd(target, host),
      permission: process.env.HOOH_PERMISSION,
      // `ace app --mock`：启动器把 --mock 译成 ACE_MOCK=1（见 ace.cmd :fe_app）；
      // 无人值守时默认**不** mock——真引擎（fail-close 同口径）。
      mock: process.env.ACE_MOCK === '1',
      debug: line => host.debug(line),
      stderr: line => (host.stderr ?? host.debug)(line),
    })
    return await openHoohSession(proc, host)
  },
  // v1 不做目录：ace 的会话恢复走引擎自己的 /resume（会话三件套协议已通），
  // 目录面等 resume 协议接进 open({kind:'resume'}) 再声明。
  launch: {
    sessionPrefs: (host: BackendHost) => {
      const file = host.dataDir === undefined ? undefined : join(host.dataDir, 'last-session')
      let last: string | undefined
      if (file !== undefined && existsSync(file)) {
        try { last = readTrim(file) } catch { last = undefined }
      }
      return {
        lastSession: () => last,
        setLastSession: (sessionId: string) => {
          last = sessionId
          if (file !== undefined) { try { writeTrim(file, sessionId) } catch { /* 尽力而为 */ } }
        },
        touch: () => undefined,
        forget: () => { last = undefined; if (file !== undefined) { try { writeTrim(file, '') } catch { /* 尽力而为 */ } } },
      }
    },
    resumeCommand: (sessionId: string) => `/resume ${sessionId}`,
  },
  catalog: createHoohCatalog(),
}

function readTrim(file: string): string {
  // 延迟 require 避免 ESM 顶层 fs import 的树摇问题：这里只是小文件读写。
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  return readFileSync(file, 'utf8').trim()
}

function writeTrim(file: string, value: string): void {
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
  const { dirname } = require('node:path') as typeof import('node:path')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value, 'utf8')
}

/** 供 backend-registry 的 loadBackend 断言与测试用。 */
export { HOOH_BACKEND_ID, HOOH_BACKEND_LABEL, resolveHoohPython, HoohProcess }
