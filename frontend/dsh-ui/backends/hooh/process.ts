/**
 * HooH 引擎进程的守护（NDJSON 客户端）：一个会话一个 `ai_code.py --serve`
 * 进程，stdin/stdout 走请求-响应 + 事件流（`core/ace_serve.py` 的协议）。
 *
 * 这里是**传输层**：解析帧、按 id 配对响应、把事件帧交给订阅者；
 * 协议的语义（哪个方法干什么）在 session.ts，帧→事件的翻译在 translate.ts。
 *
 * 出网点边界：这里的 spawn 由 `AgentBackend.open()` 发起，走宿主的
 * BackendHost；ace 引擎自身的出网（模型 API）由它自己的裁决链管——
 * TUI 不绕过、不代理（HooH 的硬边界：安全在模型之下）。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AceFrame } from './translate.js'
import { HOOH_BACKEND_ID } from './contract.js'

/** `choice.answer` 的动作投影（与协议口径 `core/ace_serve` 的三个 _ask 对齐）。 */
export type HoohChoiceAction =
  | { readonly type: 'pick'; readonly value: string }
  | { readonly type: 'accept' }
  | { readonly type: 'deny' }
  | { readonly type: 'text'; readonly text: string | null }
  | { readonly type: 'cancel' }

export function hoohChoicePayload(kind: string, action: HoohChoiceAction): Record<string, unknown> {
  if (kind === 'confirm') return { accepted: action.type === 'accept' }
  if (kind === 'text') {
    if (action.type === 'text' && action.text !== null && action.text !== '') return { text: action.text }
    return { text: null }
  }
  return action.type === 'pick' ? { values: [action.value] } : {}
}

export interface HoohProcessOptions {
  readonly cwd: string
  readonly mock?: boolean
  readonly permission?: string
  readonly debug?: (line: string) => void
  readonly stderr?: (line: string) => void
}

export interface HoohInitializeInfo {
  readonly protocol: number
  readonly model: string
  readonly permission: string
  readonly projectRoot: string
  readonly mock: boolean
  readonly lang: string
  readonly methods: readonly string[]
  readonly commands: Readonly<Record<string, unknown>>
}

/** 找引擎入口：仓库根的 ai_code.py（从本文件上溯三级）。 */
export function hoohEngineEntry(): string {
  const here = new URL('.', import.meta.url)
  const root = decodeURIComponent(new URL('../../../../', here).pathname).replace(/^\/([A-Za-z]:)/, '$1')
  return join(root, 'ai_code.py')
}

export function resolveHoohPython(): string {
  if (process.env.ACE_PYTHON !== undefined && process.env.ACE_PYTHON !== '') return process.env.ACE_PYTHON
  // 冻结包（PyInstaller）场景：引擎以 `ace.exe --serve` 形态随包分发，
  // HOOH_ENGINE_EXE 由启动器指向它；源码运行则回落 PATH 上的 python。
  if (process.env.HOOH_ENGINE_EXE !== undefined && process.env.HOOH_ENGINE_EXE !== ''
    && existsSync(process.env.HOOH_ENGINE_EXE)) return process.env.HOOH_ENGINE_EXE
  return 'python'
}

/** 一个 --serve 引擎进程的连接。事件与响应都在 feed() 里分发。 */
export class HoohProcess {
  readonly child: ChildProcessWithoutNullStreams
  private buf = ''
  private reqId = 0
  private readonly waiters = new Map<string, { resolve(value: Record<string, unknown>): void; reject(err: Error): void }>()
  private eventListener: ((frame: AceFrame) => void) | null = null
  private closed = false
  private readonly debug: (line: string) => void

  /** 引擎退出（正常/崩溃/被杀）：挂起的往返全部释放。 */
  readonly onExit: Promise<{ code: number | null }>

  constructor(options: HoohProcessOptions) {
    const entry = hoohEngineEntry()
    if (!existsSync(entry)) throw new Error(`hooh engine entry not found: ${entry}`)
    const args = [entry, '--serve', '--project-root', resolve(options.cwd),
      '--permission', options.permission ?? 'write']
    if (options.mock === true) args.push('--mock')
    this.debug = options.debug ?? (() => undefined)
    this.child = spawn(resolveHoohPython(), args, {
      cwd: resolve(options.cwd),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ACE_NO_ANIM: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stderr.setEncoding('utf-8')
    this.child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) if (line.trim() !== '') options.stderr?.(line)
    })
    this.child.stdout.setEncoding('utf-8')
    this.child.stdout.on('data', (chunk: string) => this.feed(chunk))
    this.onExit = new Promise((resolveExit) => {
      this.child.on('exit', code => { this.closed = true; this.releaseWaiters(); resolveExit({ code }) })
      this.child.on('error', () => { if (!this.closed) { this.closed = true; this.releaseWaiters(); resolveExit({ code: null }) } })
    })
    this.child.stdout.on('close', () => { if (!this.closed) { this.closed = true; this.releaseWaiters() } })
  }

  get alive(): boolean { return !this.closed }

  /** 等进程退出（测试与收尾用）。 */
  waitExit(): Promise<{ code: number | null }> { return this.onExit }

  /** 引擎事件帧订阅（同一时刻一个消费者：session）。返回退订函数。 */
  onEvent(listener: ((frame: AceFrame) => void) | null): () => void {
    this.eventListener = listener
    return () => { if (this.eventListener === listener) this.eventListener = null }
  }

  private releaseWaiters(): void {
    for (const w of this.waiters.values()) w.reject(new Error('hooh engine process exited'))
    this.waiters.clear()
  }

  private feed(chunk: string): void {
    this.buf += chunk
    let nl = this.buf.indexOf('\n')
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      nl = this.buf.indexOf('\n')
      if (line === '') continue
      let frame: Record<string, unknown>
      try { frame = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (frame.type === 'event') {
        const ev = frame.event as AceFrame | undefined
        if (ev !== undefined && typeof ev.type === 'string') this.eventListener?.(ev)
      } else if (frame.type === 'resp') {
        const id = String(frame.id ?? '')
        const waiter = this.waiters.get(id)
        if (waiter !== undefined) {
          this.waiters.delete(id)
          if (frame.ok === false) {
            const err = frame.error as { code?: string; message?: string } | undefined
            waiter.reject(new Error(`${err?.code ?? 'E_ENGINE'}: ${err?.message ?? 'engine error'}`))
          } else {
            waiter.resolve((frame.result ?? {}) as Record<string, unknown>)
          }
        }
      }
    }
  }

  /** 发一个请求并等它的 resp（引擎保证每个 id 恰好一个 resp）。 */
  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 3_600_000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error('hooh engine process not running'))
    const id = String(++this.reqId)
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        rej(new Error(`hooh engine request timed out: ${method}`))
      }, timeoutMs)
      this.waiters.set(id, {
        resolve: value => { clearTimeout(timer); res(value) },
        reject: err => { clearTimeout(timer); rej(err) },
      })
      this.child.stdin.write(JSON.stringify({ v: 1, type: 'req', id, method, params }) + '\n')
      this.debug(`[hooh-backend] -> ${method} (#${id})`)
    })
  }

  /** 发出去但不等 resp（引擎没有 resp 语义的应答路径；不注册 waiter）。 */
  send(method: string, params: Record<string, unknown>): void {
    if (this.closed) return
    const id = `fire${++this.reqId}`
    this.child.stdin.write(JSON.stringify({ v: 1, type: 'req', id, method, params }) + '\n')
    this.debug(`[hooh-backend] -> ${method} (fire ${id})`)
  }

  /** 握手（必须第一个发）。 */
  async initialize(stream: boolean): Promise<HoohInitializeInfo> {
    const result = await this.request('initialize', { protocol: 1, stream })
    return {
      protocol: Number(result.protocol ?? 1),
      model: String(result.model ?? 'ace'),
      permission: String(result.permission ?? 'write'),
      projectRoot: String(result.project_root ?? ''),
      mock: result.mock === true,
      lang: String(result.lang ?? 'zh'),
      methods: Array.isArray(result.methods) ? result.methods.map(String) : [],
      commands: (result.commands ?? {}) as Record<string, unknown>,
    }
  }

  /** 杀引擎（dispose 用；幂等）。 */
  kill(): void {
    try { this.child.kill() } catch { /* 已经退出 */ }
  }

  /** 内核名（诊断行用）。 */
  static get backendId(): string { return HOOH_BACKEND_ID }
}
