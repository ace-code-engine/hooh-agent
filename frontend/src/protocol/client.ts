/**
 * 协议客户端 —— 起 Python 引擎、说 NDJSON、把事件递给界面。
 *
 * 这一层是**唯一**碰进程和管道的模块。上层（React 组件）只订阅事件、只调方法，
 * 不碰 spawn、不碰 readline —— 这样组件能在测试里用假的 client 驱动
 * （见 `test/` 的 fixture 驱动），不需要真的起 Python。
 *
 * 三件事值得说明为什么这么做：
 *   1. **分帧用 readline 而不是自己切 `\n`**：一条 JSON 会被管道切成几段到达，
 *      自己切就得维护半行缓冲、还得处理最后一段没有换行的情况。readline 是对的。
 *   2. **`seq` 丢帧要报出来**：事件帧带单调 seq。丢了帧不报的话，界面上就是
 *      "工具卡片莫名少了一张"，而没有任何地方会告诉你原因。
 *   3. **stderr 单独接**：引擎往 stderr 写的是诊断信息（如"前端断开了"）。
 *      混进事件流会变成假事件，丢掉又会让排查时抓瞎 —— 所以单独转发。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';

import {
  PROTOCOL_VERSION,
  type AceEvent,
  type EventFrame,
  type ConfigData,
  type Frame,
  type GrantDecision,
  type HomeData,
  type InitializeResult,
  type RespFrame,
  type SessionsData,
  type TasksData,
} from './types.js';

export interface AceClientOptions {
  /** 项目根目录（`ai_code.py` 所在处）。默认取本包的上两级。 */
  projectRoot?: string;
  /** Python 解释器。默认按 `ACE_PYTHON` → 已知路径 → `python` 的顺序探测。 */
  pythonPath?: string;
  /** 追加给 `ai_code.py` 的参数，如 `['--mock']`。`--serve` 由本类自己加。 */
  extraArgs?: string[];
  /** 额外的环境变量。 */
  env?: Record<string, string>;
}

/**
 * 找一个真正能用的 Python。
 *
 * 为什么不能直接用 `python`：Windows 上 `python` 常常是 Microsoft Store 的执行别名
 * 存根 —— 它**不报错、无输出、退出码 49**。拿它去 spawn，症状是"引擎一声不响就退了"，
 * 而错误信息指不到任何地方。所以先探已知路径，这与 `ace.cmd` 的探测顺序同源。
 */
export function resolvePython(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    explicit,
    env.ACE_PYTHON,
    env.ACE_PYTHON_PATH,
    process.platform === 'win32' ? 'C:\\aider_env\\Scripts\\python.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Python313\\python.exe' : undefined,
    process.platform === 'win32' ? undefined : '/usr/bin/python3',
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);

  for (const c of candidates) {
    // 只有像路径的才做存在性检查；裸命令名（python / python3）交给 PATH。
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c;
    } else {
      return c;
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

export class AceClient extends EventEmitter {
  readonly pythonPath: string;
  readonly projectRoot: string;
  readonly extraArgs: string[];
  readonly env: Record<string, string>;

  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private stderrBuf = '';

  /** 收到的最大 seq，以及发现的缺口（丢帧）。诊断用，也供测试断言。 */
  lastSeq = 0;
  seqGaps: number[] = [];
  /** 已经握过手。没握手就发业务请求会被服务端回 E_NOT_READY。 */
  initialized = false;
  capabilities: InitializeResult | null = null;
  /** `initialize` 时是否要了流式增量。 */
  streamEnabled = false;

  /**
   * 首个 `event` 订阅者到来之前，事件先攒着。
   *
   * 为什么必须有这一层：引擎的 `session_start` 是在**进程启动**时发的，比界面挂载早；
   * 而事件流**没有重放**——丢一条就是永久丢。表现是状态行永远空着、会话版本号不显示，
   * 而没有任何地方会报错。所以宁可缓存，也不要丢。
   */
  private eventBuffer: AceEvent[] = [];
  private buffering = true;
  /** `shutdown()` 的幂等载体：第一次调用建 promise，后续复用（见那里的注释）。 */
  private _shutdownPromise: Promise<void> | null = null;

  constructor(opts: AceClientOptions = {}) {
    super();
    this.projectRoot = opts.projectRoot ?? defaultProjectRoot();
    this.pythonPath = resolvePython(opts.pythonPath);
    this.extraArgs = opts.extraArgs ?? [];
    this.env = opts.env ?? {};
  }

  // ---------------------------------------------------------------- 生命周期

  /** 首个 `event` 订阅者挂上时，把攒下的事件补发出去（顺序不变）。 */
  override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    const result = super.on(eventName, listener);
    if (eventName === 'event' && this.buffering) {
      this.buffering = false;
      const buffered = this.eventBuffer;
      this.eventBuffer = [];
      for (const ev of buffered) {
        super.emit('event', ev);
        if (typeof ev.type === 'string') super.emit(ev.type, ev);
      }
    }
    return result;
  }

  /** 起引擎并完成握手。握手失败会抛出，且**带上 stderr 的内容**（否则没法排查）。 */
  async start(stream = true): Promise<InitializeResult> {
    const args = [this.projectRoot + '/ai_code.py', '--serve', ...this.extraArgs];
    this.child = spawn(this.pythonPath, args, {
      cwd: this.projectRoot,
      env: {
        ...process.env,
        // 引擎是中文注释、中文界面文案；不钉死 UTF-8 的话控制台代码页会把它搅成乱码。
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        ...this.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    this.child.on('error', (err) => {
      // spawn 本身失败（解释器不存在 / 没有执行权限）。这不是"引擎报错退出"，
      // 而是"根本没起来"，所以直接告诉上层，而不是让它干等超时。
      this.emit('error', err);
    });
    this.child.on('exit', (code, signal) => {
      // 进程没了，所有还在等答案的请求永远不会有人回答 —— 必须全部拒掉，
      // 否则调用方的 Promise 永远挂着（UI 上就是"卡住不动"）。
      const err = new Error(
        `引擎已退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）`,
      );
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      this.emit('exit', code, signal);
    });

    this.child.stderr.setEncoding('utf-8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrBuf += chunk;
      if (this.stderrBuf.length > 64 * 1024) {
        this.stderrBuf = this.stderrBuf.slice(-32 * 1024);
      }
      this.emit('stderr', chunk);
    });

    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => this.onLine(line));

    const result = (await this.request('initialize', {
      protocol: PROTOCOL_VERSION,
      stream,
      client: { name: 'ace-frontend', version: '0.1.0' },
    })) as InitializeResult;

    this.initialized = true;
    this.capabilities = result;
    this.streamEnabled = Boolean(result?.stream);
    return result;
  }

  /**
   * 请求关闭，并**等引擎自己收工**。
   *
   * 为什么不能"收到 shutdown 的 resp 就 kill"：那条 resp 只说明服务循环停了，
   * 而真正的收尾在 `atexit` 里 —— 发 `session_end`、flush 会话日志、**回收 MCP 子进程**。
   * 直接 kill 会把这一串全砍掉，其中最要命的是 MCP：Python 侧明确记录过
   * "Windows 上父进程退出不会带走子进程，留着就是一堆孤儿 npx/python"。
   * 所以这里是"关管道 → 等 → 超时才强杀"，不是"立刻杀"。
   */
  async shutdown(graceMs = 10_000): Promise<void> {
    // **幂等**：Ctrl+C 会从两条路同时走到这里 —— Ink 的 `useInput`（按键）和
    // `process.on('SIGINT')`（信号）都会触发一次。两次并发的关闭会各发一条
    // shutdown 请求、各关一次 stdin，第二条拿到的是已经断掉的管道，
    // 而它 `.finally` 里的 `process.exit` 会在界面还在渲染时把进程掐掉 —— 那就是"闪退"。
    // 记下第一次的 promise，后续调用直接复用。
    this._shutdownPromise ??= this._doShutdown(graceMs);
    return this._shutdownPromise;
  }

  private async _doShutdown(graceMs: number): Promise<void> {
    const child = this.child;
    if (!child) return;

    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });

    try {
      await this.request('shutdown', {});
    } catch {
      // 引擎可能已经走了（正常竞态），或者管道先断了。都不是错误。
    }

    // 关 stdin：引擎读到 EOF 就会从服务循环退出，进而跑到 atexit 的收尾。
    try {
      child.stdin.end();
    } catch {
      /* 管道已断 */
    }

    const timer = setTimeout(() => {
      // 给够了还不走，说明它卡住了 —— 这时候杀掉是合理的，但要留痕。
      this.emit('stderr', `\n[前端] 引擎在 ${graceMs}ms 内没有自己退出，强制结束。\n`);
      try {
        child.kill();
      } catch {
        /* 已经死了 */
      }
    }, graceMs);

    await exited;
    clearTimeout(timer);
    this.rl?.close();
    this.rl = null;
    this.child = null;
  }

  /** 直接断管道。用于异常路径 / 强制退出。 */
  close(): void {
    try {
      this.rl?.close();
    } catch {
      /* 已经关了 */
    }
    try {
      this.child?.stdin.end();
    } catch {
      /* 管道已断 */
    }
    try {
      this.child?.kill();
    } catch {
      /* 已经死了 */
    }
    this.rl = null;
    this.child = null;
  }

  get stderrText(): string {
    return this.stderrBuf;
  }

  // ---------------------------------------------------------------- 请求

  /** 发一条 `req` 并等它的 `resp`。错误码原样抛出（带上 `code` 属性）。 */
  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = String(this.nextId++);
    const frame = { v: PROTOCOL_VERSION, type: 'req' as const, id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      if (!this.child) {
        reject(new Error('engine not started (call start() first)'));
        return;
      }
      this.pending.set(id, { resolve, reject });
      try {
        this.child.stdin.write(JSON.stringify(frame) + '\n');
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** 发一条用户消息。等的是引擎把这一轮跑完（可能很久 —— 期间事件照常来）。 */
  send(text: string): Promise<unknown> {
    return this.request('user.message', { text });
  }

  /** 发一条斜杠命令 / 裸命令行走同一条路（引擎侧是 `_process_line`）。 */
  command(line: string): Promise<unknown> {
    return this.request('command.exec', { line });
  }

  /** 递交审批决策。**只有在服务端正等答案时才该调** —— 否则会回 E_UNKNOWN_METHOD。 */
  answerPermission(decision: GrantDecision, feedback?: string): Promise<unknown> {
    const params: Record<string, unknown> = { decision };
    if (feedback) params.feedback = feedback;
    return this.request('permission.answer', params);
  }

  /**
   * 递交选择答案（`choice_request` 的回应）。同样**只在服务端等答案时**才该调。
   *
   * 三种形态共用一个方法，因为它们在协议上是同一条往返：
   *   - `choose`：`values: ['选中的那条文本']`
   *   - `confirm`：`accepted: true/false`
   *   - `text`：`text: '输入的文本'` 或 `cancelled: true`
   */
  answerChoice(payload: {
    values?: string[];
    accepted?: boolean;
    text?: string;
    cancelled?: boolean;
  }): Promise<unknown> {
    return this.request('choice.answer', payload as Record<string, unknown>);
  }

  /** 请求中断当前轮（两段式里的第一段）。 */
  interrupt(): Promise<unknown> {
    return this.request('session.interrupt', {});
  }

  /**
   * 取主页的结构化内容。引擎那边是 `ui/ace_home.build_home` 算好的分区，
   * 前端只负责渲染 —— 不在 TS 里重写一遍那套排序与开关逻辑。
   */
  requestHome(): Promise<HomeData> {
    return this.request('home.request', {}) as Promise<HomeData>;
  }

  /** 取任务树（目标 + 逐项待办 + 正在跑的工具）。`tree: null` = 空。 */
  requestTasks(): Promise<TasksData> {
    return this.request('tasks.request', {}) as Promise<TasksData>;
  }

  /**
   * 重读界面侧开关（vim / lang / permission）。
   *
   * 为什么需要：`/vim` 改的是**引擎**的 cfg，但按键怎么解析是前端的事 ——
   * 执行完命令后前端得重新问一次才知道要不要开 vim。
   */
  requestConfig(): Promise<ConfigData> {
    return this.request('config.request', {}) as Promise<ConfigData>;
  }

  /** 可引用的历史会话（`@session` 菜单的候选）。 */
  requestSessions(): Promise<SessionsData> {
    return this.request('sessions.request', {}) as Promise<SessionsData>;
  }

  // ---------------------------------------------------------------- 收帧

  private onLine(line: string): void {
    const raw = line.trim();
    if (!raw) return;
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      // 不是 JSON：说明有人在往 stdout 写人话。这是**协议违规**，要报出来而不是吞掉 ——
      // 吞掉的话表现是"某个事件莫名少了"，排查时完全指不向这里。
      this.emit('protocol-violation', raw);
      return;
    }

    if (frame.type === 'resp') {
      this.onResp(frame);
      return;
    }
    if (frame.type === 'event') {
      this.onEvent(frame);
      return;
    }
    this.emit('protocol-violation', raw);
  }

  private onResp(frame: RespFrame): void {
    const p = this.pending.get(frame.id);
    if (!p) {
      // 没人等的 resp：多半是服务端对畸形行回的那条（id 是空串），或我们已经放弃了。
      this.emit('orphan-resp', frame);
      return;
    }
    this.pending.delete(frame.id);
    if (frame.ok) {
      p.resolve(frame.result ?? {});
    } else {
      const err = new Error(frame.error?.message || 'engine returned a failure');
      Object.assign(err, { code: frame.error?.code ?? 'E_UNKNOWN' });
      p.reject(err);
    }
  }

  private onEvent(frame: EventFrame): void {
    const seq = Number(frame.seq);
    if (Number.isFinite(seq)) {
      if (seq !== this.lastSeq + 1 && this.lastSeq !== 0) {
        // 缺口：中间有帧没到。记下来并报出去 —— 静默丢失会让界面少东西而无人知情。
        for (let s = this.lastSeq + 1; s < seq; s++) this.seqGaps.push(s);
        this.emit('seq-gap', { expected: this.lastSeq + 1, got: seq });
      }
      this.lastSeq = Math.max(this.lastSeq, seq);
    }
    const ev = frame.event as AceEvent;
    // 还没人订阅：先攒着（见 `eventBuffer` 的说明）。攒的事件在首个订阅者
    // 挂上时按原顺序补发 —— 顺序不能乱，`tool_start` 必须早于 `tool_result`。
    if (this.buffering) {
      this.eventBuffer.push(ev);
      return;
    }
    this.emit('event', ev);
    if (ev && typeof ev.type === 'string') {
      this.emit(ev.type, ev); // 按类型订阅：client.on('tool_start', ...)
    }
  }
}

/** 默认项目根：本文件在 `<root>/frontend/src/protocol/`，往上三级就是 `<root>`。 */
function defaultProjectRoot(): string {
  const here = new URL(import.meta.url).pathname;
  // Windows 上 pathname 形如 /C:/...，去掉前导斜杠
  const norm = here.replace(/^\/([A-Za-z]:)/, '$1');
  return norm.replace(/\/frontend\/src\/protocol\/client\.(ts|js)$/, '');
}
