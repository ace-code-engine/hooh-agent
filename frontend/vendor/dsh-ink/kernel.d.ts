/**
 * 手写类型基座：vendored 内核 `frontend/vendor/dsh-ink/`（上游编译产物，135 个 `.js`、
 * 零 `.d.ts`）的公开面。与 `kernel.js` 一一对应 —— **只给这一个入口补类型**，
 * vendor 里的 `.js` 一个字节都没动（逐字节拷贝的合规证据保持原样）。
 *
 * 用法（interface A）：
 *   import { Box, Text } from '../../vendor/dsh-ink/kernel.js';
 *
 * 取舍：`Box`/`Text` 的布局 props 用 `[key: string]: unknown` 兜底 —— 内核的 Yoga 布局
 * 属性有 60+ 个，手抄一遍只会腐烂；代价是拼错的 prop 名不会当场报错（运行时内核也不校验）。
 * 真正要紧的是 hook/入口的签名，那些下面都是精确的。
 */
import type { ComponentType, Context, ReactNode, Ref, RefObject } from 'react';

/** `TerminalSizeContext` 的 value 形状（唯一来源：`components/app.js` 里 Provider 的 value）。 */
export interface TerminalSize {
  columns: number;
  rows: number;
}

// ---- 组件级指针/焦点/键盘事件（`events/*.js`，GUI 化补类型，WP-GUI §五.0）----
// 形状按运行时类逐字段对出来的；坐标 0 起（screen 系），`local*` 在派发时按
// 当前 handler 的节点矩形重算 —— 容器拿到的是相对自己的坐标。

/** 指针事件基座（`events/pointer-event.js`）。 */
export interface KernelPointerEvent {
  readonly col: number;
  readonly row: number;
  /** 原始 SGR 按钮字节；shift/alt/ctrl 从中解出（SGR 位 0x04/0x08/0x10）。 */
  readonly button: number;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly localCol: number;
  readonly localRow: number;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

/** 左键释放且未拖拽（`events/click-event.js`）。 */
export interface KernelClickEvent extends KernelPointerEvent {
  /** 点在空白单元（screen buffer 未写入）上 —— 过滤"点文字右边空白"的误触用。 */
  readonly cellIsBlank: boolean;
}

/** 滚轮（`events/wheel-event.js`）：delta 以行/列计，正 = 向下 / 向右。 */
export interface KernelWheelEvent extends KernelPointerEvent {
  readonly deltaY: number;
  readonly deltaX: number;
}

/**
 * 拖拽（`events/drag-event.js`）：DOM HTML5 拖拽语义子集 —— 按下后**动了才**
 * 触发 dragstart；按下+原样松开仍是 click。shift/alt/ctrl 按下不开启拖拽
 * （留给原生文本选择）。
 */
export interface KernelDragEvent extends KernelPointerEvent {
  readonly startCol: number;
  readonly startRow: number;
}

/** 组件键盘事件（`events/keyboard-event.js`）：可打印键 `key.length === 1`。 */
export interface KernelKeyboardEvent {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  /** Cmd/Win，仅 kitty 键盘协议上报。 */
  readonly superKey: boolean;
  readonly fn: boolean;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

/** 组件焦点事件（`events/focus-event.js`），focusin/focusout 语义，冒泡。 */
export interface KernelFocusEvent {
  readonly relatedTarget: unknown;
}

export interface BoxProps {
  children?: ReactNode;
  /** React 19 里 `ref` 就是普通 prop（内核用函数组件 + props.ref，不是 forwardRef）。 */
  ref?: Ref<unknown>;
  // ---- 交互（运行时 `components/box.js` 一直支持，这里补类型；命中测试与
  // z 序由内核 hit-test.js 的 hitTestWithOverlays 负责，绝对定位节点按挂载逆序）----
  tabIndex?: number;
  autoFocus?: boolean;
  onClick?: (e: KernelClickEvent) => void;
  onContextMenu?: (e: KernelPointerEvent) => void;
  onWheel?: (e: KernelWheelEvent) => void;
  onDragStart?: (e: KernelDragEvent) => void;
  onDragMove?: (e: KernelDragEvent) => void;
  onDragEnd?: (e: KernelDragEvent) => void;
  onMouseEnter?: (e: KernelPointerEvent) => void;
  onMouseLeave?: (e: KernelPointerEvent) => void;
  onFocus?: (e: KernelFocusEvent) => void;
  onBlur?: (e: KernelFocusEvent) => void;
  onKeyDown?: (e: KernelKeyboardEvent) => void;
  /** 其余全部是 Yoga 布局属性：flexDirection / paddingX / borderStyle / gap / width / height / overflow … */
  [layoutProp: string]: unknown;
}

/** Flex 布局容器（`components/box.js`，`React.memo`）。 */
export declare const Box: ComponentType<BoxProps>;

export interface TextProps {
  children?: ReactNode;
  ref?: Ref<unknown>;
  wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end';
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  [textProp: string]: unknown;
}

/** 文本叶子（`components/text.js`，`React.memo`）。 */
export declare const Text: ComponentType<TextProps>;

/** 备用屏（`components/alternatescreen.js`）：占用 1049 + 鼠标/焦点模式，靠 TerminalWriteContext 出声。 */
export declare const AlternateScreen: ComponentType<{ children?: ReactNode; mouseTracking?: boolean }>;

/** `ScrollBox` 的命令式句柄（`components/scrollbox.js` useImperativeHandle 的成员子集）。 */
export interface ScrollBoxHandle {
  scrollTo(y: number): void;
  scrollToElement(el: unknown, offset?: number): void;
  scrollBy(dy: number): void;
  scrollToBottom(): void;
  getScrollTop(): number;
  getScrollHeight(): number;
  getViewportHeight(): number;
  isSticky(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface ScrollBoxProps extends BoxProps {
  ref?: Ref<ScrollBoxHandle>;
  /** 跟随底部：新内容进来时保持贴底，用户往上滚则自动解绑。 */
  stickyScroll?: boolean;
}

/** 视口裁剪 + 命令式滚动的容器（`components/scrollbox.js`）。 */
export declare const ScrollBox: ComponentType<ScrollBoxProps>;

/** 终端尺寸 context（`components/terminalsizecontext.js`：`createContext(null)`，默认值是 null）。 */
export declare const TerminalSizeContext: Context<TerminalSize | null>;

/** 读终端尺寸；**必须在 Provider（或 `<App>`）内调用，否则当场抛错**（`hooks/use-terminal-size.js:8`）。 */
export declare function useTerminalSize(): TerminalSize;

/** `AppContext` 的 value（`components/appcontext.js` + `app.js` 的 Provider value）。 */
export interface AppContextValue {
  /** 退出应用（可选带错误）。 */
  exit: (error?: Error) => void;
  /** 内核正在写的那个 stdout（`columns` / `rows` / `on('resize')` 都在）。 */
  stdout: NodeJS.WriteStream;
}

/** 取当前 App 的 stdout / exit（`hooks/use-app.js`）。**没有 `useStdout`，用这个。** */
export declare function useApp(): AppContextValue;

/** 键位标志：上游 ink 的超集（多出 wheel 四个方向、home/end/fn/super/mouseCol/mouseRow/isPasted）。 */
export interface Key {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  wheelUp: boolean;
  wheelDown: boolean;
  wheelLeft: boolean;
  wheelRight: boolean;
  home: boolean;
  end: boolean;
  return: boolean;
  escape: boolean;
  fn: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  /** 保留字，必须引号。 */
  'super': boolean;
  isPasted: boolean;
  mouseCol: number;
  mouseRow: number;
}

/** `useInput` 的第三个参数（`events/input-event.js`）。 */
export interface InputEvent {
  input: string;
  key: Key;
  isPasted: boolean;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

/**
 * 输入 hook（`hooks/use-input.js`）。handler 少写第三个参数在 TS 里仍可赋值 ⇒ 上游写法兼容。
 * `{ isActive: false }` 保留（内核自己也在用）。
 */
export declare function useInput(
  handler: (input: string, key: Key, event: InputEvent) => void,
  options?: { isActive?: boolean },
): void;

// ---- GUI 化追加的运行时转口（与 kernel.js 一一对应，WP-GUI §五.0）----

/** 原始写函数 context（`useTerminalNotification.js`）：内核 App 在根部提供，测试路径为 null。 */
export declare const TerminalWriteContext: Context<((data: string) => void) | null>;

/** 鼠标跟踪模式序列（`termio/dec.js`：DECSET 1000/1002/1003/1006 及其关闭）。 */
export declare const ENABLE_MOUSE_TRACKING: string;
export declare const DISABLE_MOUSE_TRACKING: string;

/** 终端焦点（DECSET 1004）。无 Provider 时默认 true（context 自带默认值）。 */
export declare function useTerminalFocus(): boolean;

/**
 * 共享时钟动画 hook（`hooks/use-animation-frame.js`）：返回 `[ref, time]`，
 * ref 要挂到动画元素上（离屏自动暂停）；`intervalMs` 传 null 暂停。
 * 时钟由内核 App 根部的 ClockProvider 提供，失焦自动减速 —— 消费方不得自起 setInterval。
 */
export declare function useAnimationFrame(intervalMs?: number | null): [RefObject<unknown>, number];

/** 只读时钟时间（非 keepAlive —— 不独自驱动时钟，随 keepAlive 订阅者的节拍更新）。 */
export declare function useAnimationTimer(intervalMs: number): number;

/** 共享时钟版 setInterval（`hooks/use-interval.js`）：`intervalMs` 传 null 暂停。 */
export declare function useInterval(callback: () => void, intervalMs: number | null): void;

/** 量 Yoga 布局后的实际尺寸（`measure-element.js`）；布局前为 0。 */
export declare function measureElement(
  node: unknown,
): { width: number; height: number };

/** `renderSync` / `render` 的选项；也可以直接传一个 stdout 流（内核 `getOptions` 的短路分支）。 */
export interface RenderOptions {
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  stderr?: NodeJS.WriteStream;
  exitOnCtrlC?: boolean;
  patchConsole?: boolean;
  /** false = 关掉 sixel/kitty 图片探测（conhost 上最脆的一块）。 */
  terminalImages?: boolean;
  onFrame?: (frame: unknown) => void;
}

/** `renderSync` 返回的实例句柄（`root.js`）。 */
export interface Instance {
  rerender(node: ReactNode): void;
  unmount(): void;
  waitUntilExit(): Promise<void>;
  cleanup(): void;
  detachForShutdown(): void;
  detachStdinForHandoff(): void;
}

/** 同步挂载，返回实例（`root.js:11`）。 */
export declare function renderSync(node: ReactNode, options?: RenderOptions | NodeJS.WriteStream): Instance;

/** **异步**挂载，返回 `Promise<Instance>`（`root.js:41` 默认导出，入口里转成**具名** `render`，
 *  见 `kernel.js:34` 的 `export { default as render, … }`）—— 旧 ink 是同步的，改写点。
 *  `kernel.js` **没有 default export**，所以这里只能具名导入：`import { render } from …`。 */
export declare function render(node: ReactNode, options?: RenderOptions | NodeJS.WriteStream): Promise<Instance>;

/** 只建根不渲染（`root.js:58`），也要 await。 */
export declare function createRoot(
  options?: RenderOptions,
): Promise<{ render(node: ReactNode): void; unmount(): void; waitUntilExit(): Promise<void> }>;

/** cell 屏（`screen.js`）：`cells` 是打包存储，读字符走 `cellAtIndex`。 */
export interface KernelScreen {
  width: number;
  height: number;
  cells: Int32Array;
  charPool: { get(id: number): string };
  emptyStyleId: number;
}

export interface KernelCell {
  char: string;
  styleId: number;
  /** 0 = 窄，2 = SpacerTail（宽字符第二格），3 = SpacerHead。 */
  width: number;
  hyperlink?: string;
}

export declare function cellAtIndex(screen: KernelScreen, index: number): KernelCell;

/** 同步渲染成一张 cell 屏，不碰 TTY/stdout —— 测试基建用的就是它（`render-to-screen.js`）。 */
export declare function renderToScreen(el: ReactNode, width: number): { screen: KernelScreen; height: number };
