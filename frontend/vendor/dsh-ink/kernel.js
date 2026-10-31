/**
 * vendored 内核（dsh-ink）的**运行时公开入口** —— 换内核后 `src/**` 统一从这里 import。
 *
 * 为什么要有这个文件（而不是让 src 直接深路径 import）：
 *   1. 内核是编译产物（135 个 `.js`，零 `.d.ts`），TS 直接深路径 import 报 `TS7016`；
 *      相邻的 `kernel.d.ts` 只给这**一个**入口补类型，vendor 里的 135 个 `.js` 一个字节不动。
 *   2. 一句话定死 specifier，随后四路写手照抄即可。
 *
 * ⚠️ **specifier 必须与磁盘上的真实文件名逐字对齐（含大小写）**：Node 的 ESM 缓存按
 * specifier 字符串记模块 —— 同一个 `.js` 写两种大小写就是**两个模块实例**（实测
 * `TerminalSizeContext` 两条路径拿到的是两个不同的 context 对象，Provider 就白包了，
 * `useTerminalSize()` 当场抛"must be used within an Ink App component"）。
 * 所以下面一律照抄上游的写法（首字母大写），磁盘上的文件名也在 2026-10-31 一并改回上游
 * 的拼法：Windows 大小写不敏感，写错也能跑；Linux/CI 会直接 `Failed to load url`。
 * 判据是 `frontend/test/import-case.test.ts`（在 Windows 上也查得出来）。
 *
 * 依赖前置（缺一不可，见 `.recon/S1-switch-foundation.md` 接口 A）：
 *   1. `node frontend/vendor/dsh-ink/setup-deps.mjs` —— 建 `vendor/dsh-ink/node_modules/` 的 junction；
 *   2. `vendor/dsh-ink/node_modules/{react,react-reconciler}` **必须指到 ace 的 `frontend/node_modules`**
 *      （不是 dsh-tui 那份）。否则核实用 dsh-tui 的 React、`src/**` 用 ace 的 React ——
 *      两份 React 19 的元素能互认，但 **hook 不行**：src 组件一调 `useState` 就
 *      "Invalid hook call"，屏幕静默变空。见报告里的实测。
 */
export { default as Box } from './lib/types/ink/components/Box.js';
export { default as Text } from './lib/types/ink/components/Text.js';
export { default as ScrollBox } from './lib/types/ink/components/ScrollBox.js';
export { AlternateScreen } from './lib/types/ink/components/AlternateScreen.js';
export { TerminalSizeContext } from './lib/types/ink/components/TerminalSizeContext.js';

export { default as useInput } from './lib/types/ink/hooks/use-input.js';
export { default as useApp } from './lib/types/ink/hooks/use-app.js';
export { useTerminalSize } from './lib/types/ink/hooks/use-terminal-size.js';

// —— GUI 化追加（WP-GUI，docs/design/GUI-OVERHAUL.md §五.0）——
// 这些内部件运行时一直存在，只是此前没转口。specifier 与磁盘上的上游文件名逐字对齐
// （下面几个文件内核内部没有第二种写法的引用，不存在双实例陷阱）。
//
// 原始写函数（内核 App 在根部挂 TerminalWriteProvider；renderToScreen 没有 ⇒ null）。
// 鼠标模式序列要用它出声，与 <AlternateScreen> 同一条通道。
export { TerminalWriteContext } from './lib/types/ink/useTerminalNotification.js';
// DEC 私有模式常量（termio/dec.js）：鼠标跟踪的单一来源，src 侧不许自拼序列。
export { ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING } from './lib/types/ink/termio/dec.js';
// 终端焦点（DECSET 1004）：主屏鼠标的复焦自愈要用（内核只对备用屏自愈）。
export { useTerminalFocus } from './lib/types/ink/hooks/use-terminal-focus.js';
// 共享动画时钟（内核 App 在根部挂 ClockProvider，失焦自动减速）：
// 动效 ≤5 Hz 的唯一计时入口，消费方不得自起 setInterval。
export { useAnimationFrame } from './lib/types/ink/hooks/use-animation-frame.js';
export { useAnimationTimer, useInterval } from './lib/types/ink/hooks/use-interval.js';
// 测量（Yoga 计算后尺寸）：滚动条拖拽映射等要用。
export { default as measureElement } from './lib/types/ink/measure-element.js';

export { default as render, renderSync, createRoot } from './lib/types/ink/root.js';
export { renderToScreen } from './lib/types/ink/render-to-screen.js';
export { cellAtIndex } from './lib/types/ink/screen.js';
