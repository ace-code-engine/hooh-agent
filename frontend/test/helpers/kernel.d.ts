/** 手写类型：vendored 内核（编译产物，无 .d.ts）里我们用到的那几个入口。 */

/** `screen.js` 的 cell 视图：`cells` 是打包存储，读取时按需组装成对象。 */
export interface KernelCell {
  char: string;
  styleId: number;
  /** 0 = 窄，2 = SpacerTail（宽字符的第二格），3 = SpacerHead。 */
  width: number;
  hyperlink?: string;
}

/** `createScreen()` 产出的 buffer。宽字符占两格，SpacerTail 那格 `char === ''`。 */
export interface KernelScreen {
  width: number;
  height: number;
  cells: Int32Array;
  charPool: { get(id: number): string };
  emptyStyleId: number;
}

export declare function renderToScreen(
  el: unknown,
  width: number,
): { screen: KernelScreen; height: number };

export declare function cellAtIndex(screen: KernelScreen, index: number): KernelCell;

/** 内核那份 React（19）的 `createElement`。 */
export declare const createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
/** 内核那份 React 的版本号，例如 `'19.3.0'`。 */
export declare const version: string;

/** 内核自己的 `Box` / `Text`（今天 `src/**` 还没搬过去，建树时用它们）。 */
export declare const Box: import('react').ComponentType<Record<string, unknown>>;
export declare const Text: import('react').ComponentType<Record<string, unknown>>;
