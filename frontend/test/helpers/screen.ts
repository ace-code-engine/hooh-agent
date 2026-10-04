/**
 * 终端渲染断言工具 —— 走 **vendored 内核**（`frontend/vendor/dsh-ink/`）的
 * `renderToScreen()`：同步、纯 buffer、不碰 tty、不写 stdout。
 *
 * ## 为什么不用 ink-testing-library（给下一个人的留言）
 *
 * 换内核之后 `ink-testing-library` 会**整体失效**，不是调参能救的：
 *
 *  1. 它喂给 `render()` 的是一个假 stdout（`Writable`），**没有 `fd`**。内核的渲染器
 *     出帧走 `writeSync(stdout.fd ?? 1)` —— 帧直接漏到真终端，`lastFrame()` 永远空。
 *     断言不会报错，只会全变假红/假绿。
 *  2. 就算补上假 fd，那条路是**异步**的：渲染要等 React 调度再 flush 一次，测试只能
 *     靠 `setTimeout(30)` 赌，Windows 上尤其飘。
 *  3. `lastFrame()` 给的是**带 ANSI 的字符串**。想在它上面断言"列对齐"就得先剥 ANSI、
 *     再自己数宽度 —— 那份"数宽度"的代码本身就是要测的东西，循环论证。
 *
 * `renderToScreen(el, width)` 没这些问题：`LegacyRoot` + `updateContainerSync` +
 * `flushSyncWork`，**函数返回时帧已经画完**，直接在 `Screen` 的 cell 网格上取字符。
 *
 * ## 怎么取字符 / 怎么处理宽度
 *
 * `screen.cells` 是 `Int32Array`（每格 2 个字：charId + styleId/width/hyperlink），字符
 * 经 `screen.charPool.get(charId)` 取 —— `cellAtIndex(screen, idx).char` 就是这层包装。
 *
 * **宽度是网格自带的，不是数出来的**：宽字符（CJK/emoji）占 2 格，第一格是真字符，
 * 第二格是 SpacerTail（`char === ''`，拼进去等于空串）。所以拼出来的行：
 * `line.length` ≤ 列数，而 `displayWidth(line)` === 列数。**要数宽度就用 `displayWidth`，
 * 不要用 `.length`**（`.length` 数的是码点/字符数，CJK 会被少算一半）。
 *
 * ## 两个"必须"（踩过）
 *
 * - **元素树必须用内核那份 React（19）建**。React 19 的渲染器只认
 *   `Symbol.for('react.transitional.element')` 的元素；React 18 建的元素
 *   （`Symbol.for('react.element')`）会被**静默丢弃** —— 屏幕全空、不报错。所以这里导出
 *   `h`（= 内核 React 的 `createElement`）。换内核后 `src/**` 自己就是 React 19，
 *   测试直接写 JSX 即可，`h` 可以不用。
 * - **`renderToScreen` 不提供任何 React context**。树里的组件若调 `useStdout()` /
 *   `useInput()`，调用方得自己包 Provider。
 *
 * 前置（一次性）：`node frontend/vendor/dsh-ink/setup-deps.mjs`（见 vendor README）。
 */

import type { createElement as createElementType, ReactElement } from 'react';

// 内核是编译产物、没有 .d.ts（vendor 只读），类型见 kernel.d.ts。
import type { KernelScreen } from './kernel.js';
import { cellAtIndex, createElement, renderToScreen, version } from './kernel.js';

/** 内核那份 React 的 `createElement`（19）—— 内核渲染器只认它建出来的元素。 */
export const h: typeof createElementType = createElement as typeof createElementType;

/** 内核那份 React 的版本号。 */
export const kernelReactVersion: string = version;

const ELEMENT_TYPE_19 = Symbol.for('react.transitional.element');

/**
 * 内核渲染器只认 React 19 的元素。React 18 的元素会被**静默**丢掉（屏幕全空、
 * 不抛错），所以这里主动拦一道，把"空白断言"变成一句人话。
 */
function assertKernelElement(el: unknown): void {
  const t = (el as { $$typeof?: symbol } | null | undefined)?.$$typeof;
  if (t === ELEMENT_TYPE_19) return;
  const which = typeof t === 'symbol' ? Symbol.keyFor(t) : String(t);
  throw new Error(
    `元素树不是内核 React(${kernelReactVersion}) 的元素：$$typeof = ${which ?? '(无)'}。\n` +
      (which === 'react.element'
        ? '这是 React 18 建的元素，内核（React 19）会静默丢弃它 → 屏幕全空、不报错。\n' +
          '用本文件导出的 h() 建树（h(Box, props, ...children)）；换内核后 src 的 JSX 自然是 19，可直接写 JSX。'
        : '请用本文件导出的 h() 建树。'),
  );
}

export interface ScreenLines {
  /** 每行一段纯文本：行尾空白已去掉，末尾空行已去掉。 */
  lines: string[];
  /** 渲染宽度（列）。等于传给 `renderToScreen` 的 width。 */
  width: number;
  /** yoga 算出的内容高度（可能大于 `lines.length`：末尾空行被丢了）。 */
  height: number;
  /** 整段文本（`lines.join('\n')`），给 `toContain` / 快照用。 */
  text: string;
  /** 第一处含 `needle` 的行；没有则 undefined。 */
  lineWith(needle: string): string | undefined;
  /** 每一处含 `needle` 的行。 */
  linesWith(needle: string): string[];
  /** 有没有任何一行含 `needle`。 */
  has(needle: string): boolean;
}

/** 把 cell 网格按行拼成纯文本（不 trim，行宽 = 列数）。 */
function rowsOf(screen: KernelScreen): string[] {
  const rows: string[] = [];
  for (let y = 0; y < screen.height; y++) {
    const rowOff = y * screen.width;
    let line = '';
    for (let x = 0; x < screen.width; x++) line += cellAtIndex(screen, rowOff + x).char;
    rows.push(line);
  }
  return rows;
}

/**
 * 渲染一棵元素树 → 纯文本行数组（外加查询辅助）。
 *
 * @param el - React 元素树，**必须是内核那份 React 建的**（见文件头）。
 * @param width - 渲染宽度（列）。默认 80。
 */
export function renderLines(el: ReactElement, width = 80): ScreenLines {
  assertKernelElement(el);
  const { screen, height } = renderToScreen(el, width);
  if (screen.height === 0) {
    throw new Error(
      `内核渲染出 0 行（width=${width}）。多半是树里混了 React 18 建的元素/组件 —— ` +
        'React 19 的渲染器会静默丢弃它们，屏幕就空了。检查 src/** 那侧的 import 是不是还指着 React 18。',
    );
  }
  // 行尾空白是 cell 网格的填充，不是渲染内容 —— 去掉，免得 toContain 被它搅。
  const lines = rowsOf(screen).map((l) => l.replace(/\s+$/, ''));
  // 末尾空行同理（组件只画到自己需要的高度，yoga 会多给一点）。
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  return {
    lines,
    width: screen.width,
    height,
    text: lines.join('\n'),
    lineWith: (needle) => lines.find((l) => l.includes(needle)),
    linesWith: (needle) => lines.filter((l) => l.includes(needle)),
    has: (needle) => lines.some((l) => l.includes(needle)),
  };
}

/** 只要文本：`renderLines(el, width).text`。 */
export function renderText(el: ReactElement, width = 80): string {
  return renderLines(el, width).text;
}
