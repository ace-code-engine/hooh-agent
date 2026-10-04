/**
 * **交互式**挂载工具（test 侧）—— 需要按键 / 重渲染 / 卸载的用例走这里。
 *
 * ## 与 `helpers/screen.ts` 的分工
 *
 * | 用例形态 | 用哪个 | 底层 |
 * |---|---|---|
 * | 纯渲染、一次成帧、无 hook、无事件 | `renderLines()` | `renderToScreen()`（同步、无 tty、无 stdout） |
 * | 要 `useInput` / 按键 / `rerender` / `unmount` | 本文件 `mount()` | 内核 `renderSync()` + 假 stdio |
 *
 * ## 为什么自己写而不是继续用 `ink-testing-library`
 *
 * 它整体失效了（`.recon/M2-testharness.md` / `K2-react19-impact.md` §测试面 有逐条证据）：
 *   1. 它写死 `import { render } from 'ink'` —— 上游 ink 5 的 reconciler 0.29 配不了 React 19，
 *      collect 期就 `Cannot read properties of undefined (reading 'ReactCurrentOwner')`；
 *   2. 它的假 stdout **没有 `fd`**，而内核卸载/收尾路径写 `writeSync(stdout.fd ?? 1)`；
 *   3. 它传的 `debug: true` 在新内核的 `RenderOptions` 里不存在。
 *
 * 本文件只借它的**形状**（`lastFrame / frames / stdin / stdout / rerender / unmount`），
 * 渲染器换成内核自己那份。
 *
 * ## 假 stdout 为什么 `isTTY = false`（关键，别改成 true）
 *
 * 内核 `LogUpdate.render()` 对非 TTY 走 `renderFullFrame()` —— 每次渲染都把**整屏**写出来；
 * TTY 路径写的是**增量 diff**（`lastFrame()` 只会拿到变化的那几列，断言全瞎）。
 * 而且非 TTY 时收尾的 `writeSync(stdout.fd ?? 1)` 整块被跳过 —— 帧不会漏进真终端。
 * 内核另一条按 `columns` 布局：老 `ink-testing-library` 的假 stdout 恒为 100 列，
 * 所以这里默认也是 **100**，让迁过来的断言看到同一个宽度。
 */

import { EventEmitter } from 'node:events';
import type { ReactNode } from 'react';

import { renderSync } from '../vendor/dsh-ink/kernel.js';
import type { RenderOptions } from '../vendor/dsh-ink/kernel.js';

/**
 * 剥掉控制序列后还剩不剩字 —— 用来分辨"一帧画面"和"终端探询"。
 *
 * 内核会在挂载期往 stdout 写探询/开关序列（DA1 `\x1b[c`、BSU/ESU `\x1b[?2026h`、
 * OSC8 超链接、DECSET 焦点/粘贴…）。老 `ink-testing-library` 的 `lastFrame()` 只是
 * "最后一次 write"，在新内核下会**经常拿到一串控制序列**（实测：`\x1b[c` 排在一帧之后）
 * —— 断言于是假红。所以这里只把"能看见字"的那次写当成帧。
 *
 * 覆盖 CSI（`\x1b[...X`）、OSC（`\x1b]...BEL/ST`）与两字符转义。
 */
// 参数字节是 0x30–0x3F（`[0-9:;<=>?]`）—— 少了 `>` 这种"私有参数"前缀，
// `\x1b[>0q`（二次设备属性查询）会被当成有字（实测踩过）。
const CONTROL_SEQ = /\u001b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;

function hasVisibleText(chunk: string): boolean {
  return chunk.replace(CONTROL_SEQ, '').trim() !== '';
}

/** 假 stdout：只接 `write`（内核非 TTY 出帧就这一条路），顺便记帧。 */
export class FakeStdout extends EventEmitter {
  readonly frames: string[] = [];
  /** 内核按它算列数（非 TTY 下不会去看 `rows`）。 */
  columns: number;
  rows = 24;
  isTTY = false;
  private raw?: string;

  constructor(columns: number) {
    super();
    this.columns = columns;
  }

  write = (chunk: string): boolean => {
    this.frames.push(chunk);
    this.raw = chunk;
    return true;
  };

  /**
   * 最后一帧**画面** —— 与 `ink-testing-library` 的 `lastFrame()` 同义，
   * 只是跳过纯控制序列的写（见 `hasVisibleText` 的说明）。
   * 一次画面都没写过时退回最后一次写，别让调用方拿到 undefined。
   */
  lastFrame = (): string | undefined => {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const chunk = this.frames[i]!;
      if (hasVisibleText(chunk)) return chunk;
    }
    return this.raw;
  };
}

/** 假 stderr：同 stdout，只是没有列数。 */
export class FakeStderr extends EventEmitter {
  readonly frames: string[] = [];
  isTTY = false;
  write = (chunk: string): boolean => {
    this.frames.push(chunk);
    return true;
  };
}

/**
 * 假 stdin：内核 App 用的是 `on('readable')` + `read()` 那一套，
 * 所以 `write()` 必须两件事都做（少了 `readable`，按键根本递不进去）。
 */
export class FakeStdin extends EventEmitter {
  isTTY = true;
  private buffered: string | null = null;

  write = (data: string): void => {
    this.buffered = data;
    this.emit('readable');
    this.emit('data', data);
  };

  read = (): string | null => {
    const data = this.buffered;
    this.buffered = null;
    return data;
  };

  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

export interface MountedTree {
  readonly stdout: FakeStdout;
  readonly stderr: FakeStderr;
  readonly stdin: FakeStdin;
  /** 每一帧（`stdout.write` 的每一次调用，按序）。 */
  readonly frames: string[];
  lastFrame(): string | undefined;
  rerender(tree: ReactNode): void;
  unmount(): void;
  cleanup(): void;
}

export interface MountOptions {
  /** 渲染宽度（列）。默认 100 —— 与老 `ink-testing-library` 的假 stdout 一致。 */
  width?: number;
}

/**
 * 等 `check()` 成真（每 5ms 轮询，最多 `timeoutMs`）。
 *
 * 为什么需要它：`await tick()` 是固定 sleep，34 个套件并行时机器一忙就会被拉长 ——
 * 实测 `fullscreen-wiring` 的两条"PageUp 之后出现提示"在**全量并行**下假红、单跑却绿。
 * 它只负责"等到"，判断仍然交给调用处的 `expect`（超时后由 expect 报真正的红）。
 */
export async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** 挂载一棵树，返回与 `ink-testing-library` 同形状的句柄。
 *  叫 `mountTree` 而不是 `mount`：好几个用例文件自己就有个 `mount()` 辅助函数。 */
export function mountTree(tree: ReactNode, options: MountOptions = {}): MountedTree {
  const stdout = new FakeStdout(options.width ?? 100);
  const stderr = new FakeStderr();
  const stdin = new FakeStdin();

  const instance = renderSync(tree, {
    stdout,
    stderr,
    stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    // 测试环境不做 sixel/kitty 图片探测：conhost 上最脆的一块，且与断言无关。
    terminalImages: false,
  } as unknown as RenderOptions);

  return {
    stdout,
    stderr,
    stdin,
    frames: stdout.frames,
    lastFrame: stdout.lastFrame,
    rerender: (next: ReactNode) => instance.rerender(next),
    unmount: () => instance.unmount(),
    cleanup: () => instance.cleanup(),
  };
}
